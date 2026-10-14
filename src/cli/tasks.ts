// Overnight task commands: add, task, run, queue, report, and the
// launchd agent (daemon install/uninstall).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Command } from 'commander'
import { formatUnlocks } from '../daemon/quiet-hours'
import { formatCost, formatReport, parseSince } from '../daemon/report'
import { type DaemonClient, resolveDaemonScript, resolveRuntime } from '../shared/client'
import { formatConfigErrors, loadConfig } from '../shared/config'
import { queHome, quePaths } from '../shared/paths'
import type { QueueState, TaskAddParams } from '../shared/protocol'
import type { Task } from '../shared/types'
import { CliError, findWorkspace, formatAge, printTable, withClient } from './common'
import { LAUNCHD_LABEL, plistPath, renderPlist } from './launchd'

/** `-r`: a configured repo name, a repo path, or a workspace id or name. */
async function resolveTarget(
  c: DaemonClient,
  ref: string
): Promise<Pick<TaskAddParams, 'projectId' | 'workspaceId'>> {
  const config = loadConfig({ queHome: queHome() })
  if (!config.ok) throw new CliError(`invalid config: ${formatConfigErrors(config.errors)}`)
  const named = config.config.repos[ref]
  if (named)
    return { projectId: (await c.request('project.add', { path: named.path, name: ref })).id }
  const path = resolve(ref)
  if (fs.existsSync(path) && fs.statSync(path).isDirectory()) {
    return { projectId: (await c.request('project.add', { path })).id }
  }
  return { workspaceId: (await findWorkspace(c, ref)).id }
}

function positiveNumber(value: string, flag: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new CliError(`${flag} must be a positive number`)
  return n
}

function printQueue(s: QueueState): void {
  console.log(
    `queue ${s.open ? 'open' : 'closed'} · concurrency ${s.concurrency} · ${s.running} running · ${s.queued} queued · ${s.paused} paused`
  )
}

function printTask(t: Task): void {
  const rows: Array<[string, string | number | null]> = [
    ['id', t.id],
    ['title', t.title],
    ['state', t.reason ? `${t.state} (${t.reason})` : t.state],
    ['source', t.source],
    ['workspace', t.workspaceId],
    ['branch', t.branch],
    ['pr', t.prUrl],
    ['session', t.sessionId],
    ['attempts', t.attempts],
    ['turns', `${t.turns} / ${t.maxTurns}`],
    ['cost', `${formatCost(t.costUsd)} / ${formatCost(t.maxBudgetUsd)}`],
    ['permission', t.permissionMode],
    ['created', t.createdAt],
    ['started', t.startedAt],
    ['finished', t.finishedAt],
    ['paused until', t.pausedUntil],
    ['log', join(quePaths().logsDir, 'tasks', `${t.id}.log`)]
  ]
  for (const [k, v] of rows) if (v !== null) console.log(`${k.padEnd(13)}${v}`)
  if (t.resultText) console.log(`\n${t.resultText}`)
}

export function registerTaskCommands(program: Command, daemon: Command): void {
  program
    .command('add [brief]')
    .description('queue an overnight task (a brief run headless by claude in its own workspace)')
    .requiredOption('-r, --repo <ref>', 'repo path, configured repo name, or workspace id or name')
    .option('-f, --file <file>', 'read the brief from a file')
    .option('--title <title>', 'title (default: the first line of the brief)')
    .option('--max-turns <n>', 'turn cap')
    .option('--max-budget <usd>', 'dollar cap')
    .option('--json', 'print the task as JSON')
    .action(
      (
        brief: string | undefined,
        opts: {
          repo: string
          file?: string
          title?: string
          maxTurns?: string
          maxBudget?: string
          json?: boolean
        }
      ) =>
        withClient(async (c) => {
          if (opts.file && brief) throw new CliError('pass a brief or -f <file>, not both')
          const text = opts.file ? fs.readFileSync(resolve(opts.file), 'utf8') : brief
          if (!text?.trim()) throw new CliError('a brief is required (argument or -f <file>)')
          const task = await c.request('task.add', {
            ...(await resolveTarget(c, opts.repo)),
            brief: text,
            title: opts.title,
            source: opts.file ? 'file' : 'prompt',
            maxTurns: opts.maxTurns ? positiveNumber(opts.maxTurns, '--max-turns') : undefined,
            maxBudgetUsd: opts.maxBudget
              ? positiveNumber(opts.maxBudget, '--max-budget')
              : undefined
          })
          if (opts.json) console.log(JSON.stringify(task, null, 2))
          else console.log(`${task.id}  ${task.title}`)
        })
    )

  const task = program.command('task').description('inspect and control overnight tasks')
  task
    .command('list')
    .description('list tasks')
    .option('--json', 'print JSON')
    .action((opts: { json?: boolean }) =>
      withClient(async (c) => {
        const list = await c.request('task.list')
        if (opts.json) return console.log(JSON.stringify(list, null, 2))
        if (list.length === 0) return console.log('no tasks')
        printTable(
          ['ID', 'STATE', 'REASON', 'TURNS', 'COST', 'UPDATED', 'TITLE'],
          list.map((t) => [
            t.id,
            t.state,
            t.reason ?? '-',
            String(t.turns),
            formatCost(t.costUsd),
            formatAge(t.updatedAt),
            t.title
          ])
        )
      }, false)
    )
  task
    .command('show <id>')
    .description('show one task')
    .option('--json', 'print JSON')
    .action((id: string, opts: { json?: boolean }) =>
      withClient(async (c) => {
        const t = await c.request('task.get', { id })
        if (opts.json) console.log(JSON.stringify(t, null, 2))
        else printTask(t)
      }, false)
    )
  task
    .command('stop <id>')
    .description('stop a task (kills its claude run)')
    .action((id: string) =>
      withClient(async (c) => {
        const t = await c.request('task.stop', { id })
        console.log(`${t.id} ${t.state}`)
      }, false)
    )
  task
    .command('remove <id>')
    .description('forget a task that is no longer live')
    .action((id: string) =>
      withClient(async (c) => {
        await c.request('task.remove', { id })
        console.log(`removed ${id}`)
      }, false)
    )

  program
    .command('run')
    .description('open the queue: run queued tasks until it is closed')
    .option('-j, --jobs <n>', 'how many tasks run at once (until the queue is closed)')
    .option('--json', 'print the queue state as JSON')
    .action((opts: { jobs?: string; json?: boolean }) =>
      withClient(async (c) => {
        const jobs = opts.jobs === undefined ? undefined : Number(opts.jobs)
        if (jobs !== undefined && !(Number.isInteger(jobs) && jobs > 0)) {
          throw new CliError('-j must be a positive integer')
        }
        const s = await c.request('queue.open', jobs === undefined ? {} : { concurrency: jobs })
        if (opts.json) console.log(JSON.stringify(s, null, 2))
        else printQueue(s)
      })
    )

  const queue = program.command('queue').description('the overnight queue')
  queue
    .command('close')
    .description('stop starting queued tasks (running ones finish)')
    .action(() =>
      withClient(async (c) => {
        printQueue(await c.request('queue.close'))
      }, false)
    )
  queue
    .command('status')
    .description('show the queue')
    .option('--json', 'print JSON')
    .action((opts: { json?: boolean }) =>
      withClient(async (c) => {
        const s = await c.request('queue.state')
        if (opts.json) console.log(JSON.stringify(s, null, 2))
        else printQueue(s)
      }, false)
    )

  program
    .command('report')
    .description('the morning report: what the queue did')
    .option('--since <when>', 'ISO time or a duration back from now (12h, 90m, 2d)')
    .option('--json', 'print JSON')
    .action((opts: { since?: string; json?: boolean }) =>
      withClient(async (c) => {
        const since = opts.since === undefined ? undefined : parseSince(opts.since, Date.now())
        if (since === null) throw new CliError(`invalid --since ${opts.since}`)
        const r = await c.request('report.get', since ? { since } : {})
        if (opts.json) return console.log(JSON.stringify(r, null, 2))
        const unlocks = await c.request('quiet.log', { since: r.since })
        console.log(formatReport(r, formatUnlocks(unlocks, Date.now())))
      }, false)
    )

  daemon
    .command('install')
    .description('install a launchd agent that keeps the daemon running')
    .option('--no-load', 'write the agent without loading it')
    .action((opts: { load: boolean }) => {
      const paths = quePaths()
      const file = plistPath()
      fs.mkdirSync(dirname(file), { recursive: true })
      fs.writeFileSync(
        file,
        renderPlist({
          runtime: resolveRuntime(),
          daemonScript: resolveDaemonScript(),
          queHome: paths.home,
          path: process.env.PATH ?? '/usr/bin:/bin',
          logPath: join(paths.logsDir, 'launchd.log')
        })
      )
      console.log(`wrote ${file}`)
      if (opts.load) {
        const uid = process.getuid?.() ?? 0
        execFileSync('launchctl', ['bootstrap', `gui/${uid}`, file], { stdio: 'inherit' })
        console.log(`loaded ${LAUNCHD_LABEL}`)
      }
    })
  daemon
    .command('uninstall')
    .description('remove the launchd agent')
    .option('--no-load', 'remove the file without unloading the agent')
    .action((opts: { load: boolean }) => {
      const file = plistPath()
      if (opts.load && fs.existsSync(file)) {
        const uid = process.getuid?.() ?? 0
        try {
          execFileSync('launchctl', ['bootout', `gui/${uid}`, file], { stdio: 'inherit' })
        } catch {
          // Not loaded.
        }
      }
      fs.rmSync(file, { force: true })
      console.log(`removed ${file}`)
    })
}
