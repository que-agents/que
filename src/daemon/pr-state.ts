// Maps one decoded item of `gh pr list --json ...` (pr-state.decode.ts) onto
// the PullRequest que keeps.
import type { CheckState, PrCheck, PullRequest } from '../shared/types'
import type { GhCheck, GhPullRequest } from './pr-state.decode'

const FAILED = new Set([
  'FAILURE',
  'ERROR',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE'
])

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

function checkOf(c: GhCheck): PrCheck {
  if (c.kind === 'status') {
    const state = statusContextState(c.state)

    return {
      name: c.name,
      source: null,
      state,
      url: c.targetUrl,
      startedAt: null,
      completedAt: state === 'pending' ? null : c.createdAt
    }
  }

  return {
    name: c.name,
    source: c.workflowName,
    state: checkRunState(c.status, c.conclusion),
    url: c.detailsUrl,
    startedAt: c.startedAt,
    completedAt: c.completedAt
  }
}

/** The rollup's check runs and commit statuses, failing first, then pending, passing, skipped; by name within each. */
export function checkRunsOf(rollup: GhCheck[]): PrCheck[] {
  return rollup
    .map(checkOf)
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name))
}

/** The combined state of the runs. */
function checksOf(runs: PrCheck[]): PullRequest['checks'] {
  if (runs.length === 0) return 'none'

  if (runs.some((r) => r.state === 'failing')) return 'failing'

  if (runs.some((r) => r.state === 'pending')) return 'pending'

  return 'passing'
}

function reviewOf(decision: string): PullRequest['review'] {
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

/** A decoded `gh pr list` item as the PullRequest que keeps. */
export function parsePullRequest(r: GhPullRequest, checkedAt: string): PullRequest {
  let state: PullRequest['state'] = 'open'

  if (r.mergedAt || r.state === 'MERGED') state = 'merged'
  else if (r.state === 'CLOSED') state = 'closed'
  else if (r.isDraft) state = 'draft'
  const checkRuns = checkRunsOf(r.checks)

  return {
    url: r.url,
    number: r.number,
    title: r.title,
    state,
    checks: checksOf(checkRuns),
    review: reviewOf(r.reviewDecision),
    checkRuns,
    updatedAt: r.updatedAt,
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
