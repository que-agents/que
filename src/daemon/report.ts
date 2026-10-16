// The morning report, as pure functions: which tasks to show, grouped by
// outcome with durations and totals, and its plain-text rendering.
import type { Report, ReportEntry, ReportGroup, WorkspaceDigest } from '../shared/protocol'
import type { Task, TaskState } from '../shared/types'

/** Reading order: outcomes first, what still needs a look next, stopped last. */
export const REPORT_GROUPS: ReportGroup[] = [
  'done',
  'stuck',
  'failed',
  'paused',
  'running',
  'queued',
  'stopped'
]

const GROUP_OF: Record<TaskState, ReportGroup> = {
  done: 'done',
  stuck: 'stuck',
  failed: 'failed',
  stopped: 'stopped',
  paused: 'paused',
  preparing: 'running',
  running: 'running',
  finishing: 'running',
  queued: 'queued'
}

const LIVE: ReadonlySet<TaskState> = new Set([
  'queued',
  'preparing',
  'running',
  'paused',
  'finishing'
])

export const DEFAULT_REPORT_WINDOW_MS = 24 * 3_600_000

/** The report window's start: the explicit `since`, else the last queue.open, else 24 h ago. */
export function reportSince(
  since: string | undefined,
  openedAt: string | null,
  now: number
): string {
  if (since) return new Date(Date.parse(since)).toISOString()

  if (openedAt) return openedAt

  return new Date(now - DEFAULT_REPORT_WINDOW_MS).toISOString()
}

function entry(task: Task, workspaces: ReadonlyMap<string, string>, now: number): ReportEntry {
  const start = task.startedAt ? Date.parse(task.startedAt) : null
  const end = task.finishedAt ? Date.parse(task.finishedAt) : now

  return {
    id: task.id,
    title: task.title,
    state: task.state,
    reason: task.reason,
    workspace: task.workspaceId ? (workspaces.get(task.workspaceId) ?? task.workspaceId) : null,
    workspaceId: task.workspaceId,
    branch: task.branch,
    prUrl: task.prUrl,
    durationMs: start === null ? null : Math.max(0, end - start),
    turns: task.turns,
    costUsd: task.costUsd
  }
}

/**
 * Every task that changed since `since`, plus every live one, grouped by
 * outcome (oldest first within a group, keeping the given order for ties) with totals.
 */
export function buildReport(
  tasks: readonly Task[],
  workspaces: ReadonlyMap<string, string>,
  since: string,
  now: number,
  digests: readonly WorkspaceDigest[] = []
): Report {
  const from = Date.parse(since)

  const groups = Object.fromEntries(REPORT_GROUPS.map((g) => [g, [] as ReportEntry[]])) as Record<
    ReportGroup,
    ReportEntry[]
  >

  const totals = {
    tasks: 0,
    prs: 0,
    turns: 0,
    costUsd: 0,
    durationMs: 0,
    workspaces: 0,
    needsInput: 0
  }

  const shown = tasks
    .filter((t) => LIVE.has(t.state) || Date.parse(t.updatedAt) >= from)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  for (const t of shown) {
    const e = entry(t, workspaces, now)
    groups[GROUP_OF[t.state]].push(e)
    totals.tasks += 1

    if (e.prUrl) totals.prs += 1
    totals.turns += e.turns
    totals.costUsd += e.costUsd
    totals.durationMs += e.durationMs ?? 0
  }

  totals.workspaces = digests.length
  totals.needsInput = digests.filter((d) => d.status === 'needs_input').length
  totals.costUsd = Math.round(totals.costUsd * 10_000) / 10_000

  return {
    since,
    generatedAt: new Date(now).toISOString(),
    groups,
    workspaces: [...digests],
    totals
  }
}

/** `0s`, `45s`, `12m`, `1h 05m`; `-` when unknown. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '-'
  const s = Math.floor(ms / 1000)

  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)

  if (m < 60) return `${m}m`

  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

const UNITS = new Map([
  ['m', 60_000],
  ['h', 3_600_000],
  ['d', 86_400_000]
])

/** `--since`: an ISO time, or a duration back from now like `90m`, `12h`, `2d`. */
export function parseSince(value: string, now: number): string | null {
  const rel = /^(\d+(?:\.\d+)?)([mhd])$/.exec(value.trim())

  const unit = rel && UNITS.get(rel[2])

  if (rel && unit) return new Date(now - Number(rel[1]) * unit).toISOString()
  const t = Date.parse(value)

  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

const HEADINGS: Record<ReportGroup, string> = {
  done: 'Done',
  stuck: 'Stuck',
  failed: 'Failed',
  stopped: 'Stopped',
  paused: 'Paused',
  running: 'Running',
  queued: 'Queued'
}

function clock(iso: string): string {
  const d = new Date(iso)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function digestLines(d: WorkspaceDigest): string[] {
  const status = d.statusReason ? `${d.status} (${d.statusReason})` : d.status

  const facts = [
    d.workingMs > 0 ? `worked ${formatDuration(d.workingMs)}` : 'no work in this window',
    d.needsInputCount > 0 ? `asked for input ${d.needsInputCount}×` : null,
    d.waitingSince ? `waiting since ${clock(d.waitingSince)}` : null,
    d.commitsAhead !== null ? `${d.commitsAhead} commits ahead` : null,
    d.pr
      ? `PR #${d.pr.number} ${d.pr.state}${d.pr.checks === 'failing' ? ', checks failing' : ''}`
      : null
  ].filter((f): f is string => f !== null)

  return [`  ${d.name} · ${d.project} · ${status}`, `    ${facts.join(' · ')}`]
}

/** The report as plain text for `que report`, with the unlocks line when given. */
export function formatReport(r: Report, unlocks?: string): string {
  const lines = [`que report since ${r.since}`]

  for (const g of REPORT_GROUPS) {
    const list = r.groups[g]

    if (list.length === 0) continue
    lines.push('', `${HEADINGS[g]} (${list.length})`)

    for (const e of list) {
      const facts = [
        e.reason,
        e.workspace,
        e.branch && e.branch !== e.workspace ? e.branch : null,
        formatDuration(e.durationMs),
        `${e.turns} turns`,
        formatCost(e.costUsd)
      ].filter((f): f is string => Boolean(f))

      lines.push(`  ${e.title}`, `    ${facts.join(' · ')}`)

      if (e.prUrl) lines.push(`    ${e.prUrl}`)
    }
  }

  if (r.workspaces.length > 0) {
    lines.push('', `Workspaces (${r.workspaces.length})`)

    for (const d of r.workspaces) lines.push(...digestLines(d))
  }

  if (r.totals.tasks === 0 && r.workspaces.length === 0) {
    lines.push('', 'No tasks in this window.')
  }

  if (unlocks) lines.push('', unlocks)
  lines.push(
    '',
    `Total: ${r.totals.tasks} tasks · ${r.totals.prs} PRs · ${r.totals.turns} turns · ${formatCost(r.totals.costUsd)} · ${formatDuration(r.totals.durationMs)}`
  )

  return lines.join('\n')
}
