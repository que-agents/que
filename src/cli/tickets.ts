// Ticket queue commands: list, sync, start, open.
import { execFileSync } from 'node:child_process'
import type { Command } from 'commander'
import type { DaemonClient } from '../shared/client'
import type { TicketsListResult } from '../shared/protocol'
import type { Ticket } from '../shared/types'
import { formatAge } from '../shared/format'
import { CliError, findProject, printJson, withClient } from './common'

const SUMMARY_WIDTH = 60

function truncate(s: string, width: number): string {
  return s.length <= width ? s : `${s.slice(0, width - 1)}…`
}

async function printList(c: DaemonClient, r: TicketsListResult): Promise<void> {
  if (r.sync.error) console.log(`sync error: ${r.sync.error}`)

  if (r.tickets.length === 0) {
    console.log('no tickets')

    return
  }

  const names = new Map<string, string>()

  if (r.tickets.some((t) => t.workspaceId)) {
    for (const w of await c.request('workspace.list')) names.set(w.id, w.name)
  }

  const cells = (t: Ticket, depth: number): string[] => [
    `${'  '.repeat(depth)}${t.key}`,
    truncate(t.summary, SUMMARY_WIDTH),
    t.status,
    t.priority ?? '-',
    formatAge(t.updatedAt, Date.now()),
    t.workspaceId ? (names.get(t.workspaceId) ?? t.workspaceId) : '-'
  ]

  const keys = new Set(r.tickets.map((t) => t.key))
  const children = new Map<string, Ticket[]>()

  for (const t of r.tickets) {
    if (t.parentKey && keys.has(t.parentKey)) {
      children.set(t.parentKey, [...(children.get(t.parentKey) ?? []), t])
    }
  }

  const roots = r.tickets.filter((t) => !t.parentKey || !keys.has(t.parentKey))
  const isEpic = (t: Ticket): boolean => t.level === 'epic'

  type Entry = { epic: string } | { row: string[] }

  const entries: Entry[] = []

  const add = (t: Ticket, depth: number): void => {
    const nested = isEpic(t) ? 1 : depth + 1

    if (isEpic(t)) {
      const mark = t.assigned ? '' : ' (not yours)'
      entries.push({ epic: `${t.key}  ${truncate(t.summary, SUMMARY_WIDTH)}  ${t.status}${mark}` })
    } else entries.push({ row: cells(t, depth) })

    for (const c of children.get(t.key) ?? []) add(c, nested)
  }

  for (const t of roots.filter(isEpic)) add(t, 0)

  for (const t of roots.filter((x) => !isEpic(x))) add(t, 0)

  const header = ['KEY', 'SUMMARY', 'STATUS', 'PRIORITY', 'UPDATED', 'WORKSPACE']
  const rows = entries.flatMap((e) => ('row' in e ? [e.row] : []))
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)))

  const fmt = (row: string[]): string =>
    row
      .map((c, i) => c.padEnd(widths[i]))
      .join('  ')
      .trimEnd()

  console.log(fmt(header))

  for (const e of entries) console.log('epic' in e ? e.epic : fmt(e.row))
}

export function registerTicketCommands(program: Command): void {
  const tickets = program
    .command('tickets')
    .description('the ticket queue: tickets assigned to you in the tracker')

  tickets
    .command('list', { isDefault: true })
    .description('list the cached tickets (the default)')
    .option('--json', 'print the tickets and sync state as JSON')
    .action(async (opts: { json?: boolean }) => {
      await withClient(async (c) => {
        const r = await c.request('tickets.list', {})

        if (opts.json) printJson(r)
        else await printList(c, r)
      })
    })

  tickets
    .command('sync')
    .description('fetch the queue from the tracker now')
    .option('--json', 'print the tickets and sync state as JSON')
    .action(async (opts: { json?: boolean }) => {
      await withClient(async (c) => {
        const r = await c.request('tickets.sync', {})

        if (opts.json) printJson(r)
        else await printList(c, r)
      })
    })

  tickets
    .command('start <key>')
    .description('make a workspace for a ticket, write it as a brief, and start claude on it')
    .option('-p, --project <project>', 'que project (name, path, or id) when not yet learned')
    .option('--session', 'a loose terminal in your home directory instead of a workspace')
    .action(async (key: string, opts: { project?: string; session?: boolean }) => {
      await withClient(async (c) => {
        const projectId = opts.project ? (await findProject(c, opts.project)).id : undefined

        const r = await c.request('tickets.start', {
          key,
          projectId,
          session: opts.session || undefined
        })

        if (r.kind === 'needs_project') {
          console.error('que cannot tell which project; pass -p <project>:')

          for (const p of r.projects) console.error(`  ${p.name}`)
          process.exitCode = 2
        } else if (r.kind === 'session') {
          console.log(`session ${r.terminalId}`)
        } else {
          console.log(r.workspace.name)
        }
      })
    })

  tickets
    .command('open <key>')
    .description("open a ticket's page in the browser")
    .action(async (key: string) => {
      await withClient(async (c) => {
        const ticket = (await c.request('tickets.list', {})).tickets.find((t) => t.key === key)

        if (!ticket) throw new CliError(`no ticket ${key}`)

        if (!ticket.url) throw new CliError(`${key} has no link`)
        execFileSync('open', [ticket.url], { stdio: 'inherit' })
      })
    })
}
