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

/** The `--json` output: the value as indented JSON. */
export function printJson<T>(value: T): void {
  console.log(JSON.stringify(value, null, 2))
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
 * For commands that may call no refused daemon method (opening an editor,
 * printing a live terminal's id): the same refusal the daemon would give.
 */
export async function assertNotQuiet(c: DaemonClient): Promise<void> {
  const q = await c.request('quiet.state')

  if (q.locked && q.windowEnd) {
    throw new DaemonError(
      'quiet_hours',
      quietMessage(Date.parse(q.windowEnd), q.unlockMinutes, q.kind ?? 'scheduled')
    )
  }
}

/** A workspace's name by id, or undefined when there is no id or it is gone. */
export async function workspaceNameOf(
  c: DaemonClient,
  id: string | undefined
): Promise<string | undefined> {
  if (!id) return undefined

  try {
    return (await c.request('workspace.get', { id })).name
  } catch {
    return undefined
  }
}
