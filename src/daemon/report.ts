// The morning report, as pure functions: what each workspace's session did in
// the window, the count line over them, and the plain-text rendering. No Node
// imports: the renderer reads the count line and the digest facts from here too.
import { type CountItem, countLineText } from '../shared/count-line'
import type { Report, WorkspaceDigest } from '../shared/protocol'
import { formatDuration as duration, formatSince, hhmm } from '../shared/format'
import type { QuietKind } from '../shared/types'

const DEFAULT_REPORT_WINDOW_MS = 24 * 3_600_000

/** The report window's start: the explicit `since`, else 24 hours ago. */
export function reportSince(since: string | undefined, now: number): string {
  if (since) return new Date(Date.parse(since)).toISOString()

  return new Date(now - DEFAULT_REPORT_WINDOW_MS).toISOString()
}

/** The report over the given workspace digests (already sorted), with totals. */
export function buildReport(
  digests: readonly WorkspaceDigest[],
  since: string,
  now: number
): Report {
  return {
    since,
    generatedAt: new Date(now).toISOString(),
    workspaces: [...digests],
    totals: {
      workspaces: digests.length,
      needsInput: digests.filter((d) => d.status === 'needs_input').length
    }
  }
}

/** `0s`, `45s`, `12m`, `1h 05m`; `-` when unknown. */
export function formatDuration(ms: number | null): string {
  return ms === null ? '-' : duration(ms, { seconds: false, floor: true })
}

/**
 * The report's count line, in reading order and only the non-zero items: the
 * sessions in the window (muted), those stuck (bad) and waiting for input
 * (attention) now, the pull requests still open, then the time worked in all.
 * The page, and the morning notification, print the same words.
 */
export function reportCountItems(r: Report): CountItem[] {
  const stuck = r.workspaces.filter((w) => w.status === 'stuck').length
  const prs = r.workspaces.filter((w) => w.pr?.state === 'open' || w.pr?.state === 'draft').length
  const workingMs = r.workspaces.reduce((sum, w) => sum + w.workingMs, 0)

  const items: CountItem[] = [
    {
      count: r.totals.workspaces,
      label: r.totals.workspaces === 1 ? 'session' : 'sessions',
      tone: 'muted'
    },
    { count: stuck, label: 'stuck', tone: 'bad' },
    { count: r.totals.needsInput, label: 'needs input', tone: 'attention' },
    { count: prs, label: prs === 1 ? 'PR open' : 'PRs open' },
    { count: workingMs, label: 'worked', text: `worked ${formatDuration(workingMs)}` }
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
 * A manual quiet in which no session ran ends silently (null).
 */
export function summaryNotification(
  kind: QuietKind,
  r: Report,
  now: number
): { title: string; body: string } | null {
  if (kind === 'manual' && r.totals.workspaces === 0) return null

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

/**
 * The report as plain text for `que report`: the count line (or `nothing ran
 * since …`), then a row per workspace, then the unlocks line when given.
 */
export function formatReport(r: Report, unlocks?: string): string {
  const lines = [`que report since ${r.since}`, reportSummaryText(r, Date.parse(r.generatedAt))]

  if (r.workspaces.length > 0) {
    lines.push('', `Workspaces (${r.workspaces.length})`)

    for (const d of r.workspaces) lines.push(...digestLines(d))
  }

  if (unlocks) lines.push('', unlocks)

  return lines.join('\n')
}
