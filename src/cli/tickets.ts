// Ticket queue commands: list, sync, start, open.
import { execFileSync } from 'node:child_process'
import type { Command } from 'commander'
import type { DaemonClient } from '../shared/client'
import type { TicketsListResult } from '../shared/protocol'
import { CliError, findProject, formatAge, printTable, withClient } from './common'

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
  printTable(
    ['KEY', 'SUMMARY', 'STATUS', 'PRIORITY', 'UPDATED', 'WORKSPACE'],
    r.tickets.map((t) => [
      t.key,
      truncate(t.summary, SUMMARY_WIDTH),
      t.status,
      t.priority ?? '-',
      formatAge(t.updatedAt),
      t.workspaceId ? (names.get(t.workspaceId) ?? t.workspaceId) : '-'
    ])
  )
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
        if (opts.json) console.log(JSON.stringify(r, null, 2))
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
        if (opts.json) console.log(JSON.stringify(r, null, 2))
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
          ...(projectId ? { projectId } : {}),
          ...(opts.session ? { session: true } : {})
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
