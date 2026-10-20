// The morning report, as pure functions: which tasks to show, grouped by
// outcome with durations and totals, and its plain-text rendering. No Node
// imports: the renderer reads the groups and the digest facts from here too.
import { type CountItem, countLineText } from '../shared/count-line'
import type { Report, ReportEntry, ReportGroup, WorkspaceDigest } from '../shared/protocol'
import { formatCost, formatDuration as duration, formatSince, hhmm } from '../shared/format'
import { LIVE_STATES, type QuietKind, type Task, type TaskState } from '../shared/types'

/** Reading order: outcomes first, what still needs a look next, stopped last; with headings. */
export const REPORT_GROUPS: ReadonlyArray<{ group: ReportGroup; title: string }> = [
  { group: 'done', title: 'Done' },
  { group: 'stuck', title: 'Stuck' },
  { group: 'failed', title: 'Failed' },
  { group: 'paused', title: 'Paused' },
  { group: 'running', title: 'Running' },
  { group: 'queued', title: 'Queued' },
  { group: 'stopped', title: 'Stopped' }
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
    pausedUntil: task.state === 'paused' ? task.pausedUntil : null,
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

  const groups = Object.fromEntries(
    REPORT_GROUPS.map(({ group }) => [group, [] as ReportEntry[]])
  ) as Record<ReportGroup, ReportEntry[]>

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
    .filter((t) => LIVE_STATES.has(t.state) || Date.parse(t.updatedAt) >= from)
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
  return ms === null ? '-' : duration(ms, { seconds: false, floor: true })
}

/**
 * The report's count line, in reading order and only the non-zero items:
 * done (muted), stuck (tasks and workspaces) and failed (bad), needs input
 * (attention), paused, running, queued, pull requests, then the total time
 * and cost. The page, and the morning notification, print the same words.
 */
export function reportCountItems(r: Report): CountItem[] {
  const stuckWorkspaces = r.workspaces.filter((w) => w.status === 'stuck').length

  const items: CountItem[] = [
    { count: r.groups.done.length, label: 'done', tone: 'muted' },
    { count: r.groups.stuck.length + stuckWorkspaces, label: 'stuck', tone: 'bad' },
    { count: r.groups.failed.length, label: 'failed', tone: 'bad' },
    { count: r.totals.needsInput, label: 'needs input', tone: 'attention' },
    { count: r.groups.paused.length, label: 'paused' },
    { count: r.groups.running.length, label: 'running' },
    { count: r.groups.queued.length, label: 'queued' },
    { count: r.totals.prs, label: r.totals.prs === 1 ? 'PR' : 'PRs' },
    {
      count: r.totals.durationMs,
      label: 'duration',
      text: formatDuration(r.totals.durationMs)
    },
    { count: r.totals.costUsd, label: 'cost', text: formatCost(r.totals.costUsd) }
  ]

  return items.filter((i) => i.count > 0)
}

/** What the count line says when it has no items: `nothing ran since 19:00 yesterday`. */
export function nothingRanLine(r: Pick<Report, 'since'>, now: number): string {
  return `nothing ran ${formatSince(Date.parse(r.since), now)}`
}

/** The count line as plain text, or `nothing ran since …`: the morning notification's body. */
export function reportSummaryText(r: Report, now: number): string {
  return countLineText(reportCountItems(r)) || nothingRanLine(r, now)
}

/**
 * The notification when a quiet window ends: `que · good morning` after quiet
 * hours, `que · quiet ended` after a manual quiet, both with the count line.
 * A manual quiet with no tasks and nothing waiting ends silently (null).
 */
export function summaryNotification(
  kind: QuietKind,
  r: Report,
  now: number
): { title: string; body: string } | null {
  if (kind === 'manual' && r.totals.tasks === 0 && r.totals.needsInput === 0) return null

  return {
    title: kind === 'scheduled' ? 'que · good morning' : 'que · quiet ended',
    body: reportSummaryText(r, now)
  }
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

/** `worked 1h 12m`, `asked for input 2×`, `waiting since 02:14`, `3 commits ahead`, `PR #41 open`. */
export function digestFacts(d: WorkspaceDigest): string[] {
  return [
    d.workingMs > 0 ? `worked ${formatDuration(d.workingMs)}` : 'no work in this window',
    d.needsInputCount > 0 ? `asked for input ${d.needsInputCount}×` : null,
    d.waitingSince ? `waiting since ${hhmm(Date.parse(d.waitingSince))}` : null,
    d.commitsAhead !== null ? `${d.commitsAhead} commits ahead` : null,
    d.pr
      ? `PR #${d.pr.number} ${d.pr.state}${d.pr.checks === 'failing' ? ', checks failing' : ''}`
      : null
  ].filter((f): f is string => f !== null)
}

function digestLines(d: WorkspaceDigest): string[] {
  const status = d.statusReason ? `${d.status} (${d.statusReason})` : d.status

  return [`  ${d.name} · ${d.project} · ${status}`, `    ${digestFacts(d).join(' · ')}`]
}

/** The report as plain text for `que report`, with the unlocks line when given. */
export function formatReport(r: Report, unlocks?: string): string {
  const lines = [`que report since ${r.since}`]

  for (const { group, title } of REPORT_GROUPS) {
    const list = r.groups[group]

    if (list.length === 0) continue
    lines.push('', `${title} (${list.length})`)

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
