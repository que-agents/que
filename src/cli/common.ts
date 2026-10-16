// Shared CLI helpers: daemon connection, tables, and id-or-name lookups.
import { quietMessage } from '../daemon/quiet-hours'
import { DaemonClient, DaemonError } from '../shared/client'
import type { Project, Workspace } from '../shared/types'

export class CliError extends Error {}

export async function withClient<T>(fn: (c: DaemonClient) => Promise<T>, start = true): Promise<T> {
  const client = start ? await DaemonClient.connectOrStart() : await DaemonClient.tryConnect()

  if (!client) {
    console.error('que: daemon is not running')
    process.exit(1)
  }

  try {
    return await fn(client)
  } finally {
    client.close()
  }
}

export function printTable(header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))

  const fmt = (r: string[]): string =>
    r
      .map((c, i) => c.padEnd(widths[i]))
      .join('  ')
      .trimEnd()

  console.log(fmt(header))

  for (const r of rows) console.log(fmt(r))
}

/** `42s`, `5m`, `3h`, `2d`; `-` when there is no timestamp. */
export function formatAge(iso: string | null, now = Date.now()): string {
  if (!iso) return '-'
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))

  if (s < 60) return `${s}s`

  if (s < 3600) return `${Math.floor(s / 60)}m`

  if (s < 86_400) return `${Math.floor(s / 3600)}h`

  return `${Math.floor(s / 86_400)}d`
}

export async function findProject(c: DaemonClient, ref: string): Promise<Project> {
  const projects = await c.request('project.list')

  const match =
    projects.find((p) => p.id === ref) ??
    projects.find((p) => p.path === ref) ??
    onlyOne(
      projects.filter((p) => p.name === ref),
      `project ${ref}`
    )

  if (!match) throw new CliError(`no project ${ref}`)

  return match
}

export async function findWorkspace(c: DaemonClient, ref: string): Promise<Workspace> {
  const all = await c.request('workspace.list')

  const match =
    all.find((w) => w.id === ref) ??
    onlyOne(
      all.filter((w) => w.name === ref),
      `workspace name ${ref}`
    )

  if (!match) throw new CliError(`no workspace ${ref}`)

  return match
}

function onlyOne<T extends { id: string }>(items: T[], what: string): T | undefined {
  if (items.length > 1) {
    throw new CliError(`${what} is ambiguous (${items.map((i) => i.id).join(', ')}); use the id`)
  }

  return items[0]
}

/**
 * For detail commands that call no refused daemon method themselves (opening
 * an editor, printing a terminal id): the daemon's quiet-hours refusal.
 */
export async function assertNotQuiet(c: DaemonClient): Promise<void> {
  const q = await c.request('quiet.state')

  if (q.inQuietHours && !q.unlockedUntil && q.windowEnd) {
    throw new DaemonError('quiet_hours', quietMessage(Date.parse(q.windowEnd), q.unlockMinutes))
  }
}
