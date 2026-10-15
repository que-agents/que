// Maps one item of `gh pr list --json ...` onto the PullRequest que keeps.
import type { CheckState, PrCheck, PullRequest } from '../shared/types'

const FAILED = new Set([
  'FAILURE',
  'ERROR',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE'
])

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

const ORDER: Record<CheckState, number> = { failing: 0, pending: 1, passing: 2, skipped: 3 }

/** A check run's state: anything not COMPLETED is pending, then by its conclusion. */
function checkRunState(status: string, conclusion: string): CheckState {
  if (status && status !== 'COMPLETED') return 'pending'
  if (FAILED.has(conclusion)) return 'failing'
  if (conclusion === 'SUCCESS') return 'passing'
  return 'skipped'
}

/** A commit status's state. */
function statusContextState(state: string): CheckState {
  if (state === 'SUCCESS') return 'passing'
  if (state === 'FAILURE' || state === 'ERROR') return 'failing'
  return 'pending'
}

function checkOf(i: Record<string, unknown>): PrCheck | null {
  const statusContext =
    i.__typename === 'StatusContext' ||
    (i.__typename !== 'CheckRun' && 'state' in i && !('status' in i) && !('conclusion' in i))
  if (statusContext) {
    const state = statusContextState(str(i.state))
    return {
      name: str(i.context) || str(i.name),
      source: null,
      state,
      url: strOrNull(i.targetUrl),
      startedAt: null,
      completedAt: state === 'pending' ? null : strOrNull(i.createdAt)
    }
  }
  const checkRun = i.__typename === 'CheckRun' || 'status' in i || 'conclusion' in i
  if (!checkRun) return null
  return {
    name: str(i.name) || str(i.context),
    source: strOrNull(i.workflowName),
    state: checkRunState(str(i.status), str(i.conclusion)),
    url: strOrNull(i.detailsUrl),
    startedAt: strOrNull(i.startedAt),
    completedAt: strOrNull(i.completedAt)
  }
}

/** The rollup's check runs and commit statuses, failing first, then pending, passing, skipped; by name within each. */
export function checkRunsOf(rollup: unknown): PrCheck[] {
  if (!Array.isArray(rollup)) return []
  return rollup
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map(checkOf)
    .filter((c): c is PrCheck => c !== null)
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name))
}

/** The combined state of the runs. */
function checksOf(runs: PrCheck[]): PullRequest['checks'] {
  if (runs.length === 0) return 'none'
  if (runs.some((r) => r.state === 'failing')) return 'failing'
  if (runs.some((r) => r.state === 'pending')) return 'pending'
  return 'passing'
}

function reviewOf(decision: unknown): PullRequest['review'] {
  switch (decision) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    case 'REVIEW_REQUIRED':
      return 'review_required'
    default:
      return null
  }
}

/** One `gh pr list` item as a PullRequest; null when it has no number or url. */
export function parsePullRequest(raw: unknown, checkedAt: string): PullRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.number !== 'number' || typeof r.url !== 'string' || !r.url) return null
  let state: PullRequest['state'] = 'open'
  if (r.mergedAt || r.state === 'MERGED') state = 'merged'
  else if (r.state === 'CLOSED') state = 'closed'
  else if (r.isDraft === true) state = 'draft'
  const checkRuns = checkRunsOf(r.statusCheckRollup)
  return {
    url: r.url,
    number: r.number,
    title: str(r.title),
    state,
    checks: checksOf(checkRuns),
    review: reviewOf(r.reviewDecision),
    checkRuns,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
    checkedAt
  }
}

/** True when everything but `checkedAt` matches (two nulls count as the same). */
export function samePullRequest(a: PullRequest | null, b: PullRequest | null): boolean {
  if (!a || !b) return a === b
  return (
    a.url === b.url &&
    a.number === b.number &&
    a.title === b.title &&
    a.state === b.state &&
    a.checks === b.checks &&
    a.review === b.review &&
    a.updatedAt === b.updatedAt &&
    // A pull request stored before check runs were kept has none.
    sameChecks(a.checkRuns ?? [], b.checkRuns ?? [])
  )
}

function sameChecks(a: PrCheck[], b: PrCheck[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.name === b[i].name &&
        x.source === b[i].source &&
        x.state === b[i].state &&
        x.url === b[i].url &&
        x.startedAt === b[i].startedAt &&
        x.completedAt === b[i].completedAt
    )
  )
}
