// Maps one item of `gh pr list --json ...` onto the PullRequest que keeps.
import type { PullRequest } from '../shared/types'

const FAILED = new Set([
  'FAILURE',
  'ERROR',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE'
])

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function checksOf(rollup: unknown): PullRequest['checks'] {
  if (!Array.isArray(rollup)) return 'none'
  const items = rollup.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
  if (items.length === 0) return 'none'
  const failing = items.some(
    (i) => FAILED.has(str(i.conclusion)) || ['FAILURE', 'ERROR'].includes(str(i.state))
  )
  if (failing) return 'failing'
  const pending = items.some(
    (i) =>
      (typeof i.status === 'string' && i.status !== 'COMPLETED') ||
      ['PENDING', 'EXPECTED'].includes(str(i.state))
  )
  return pending ? 'pending' : 'passing'
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
  return {
    url: r.url,
    number: r.number,
    title: str(r.title),
    state,
    checks: checksOf(r.statusCheckRollup),
    review: reviewOf(r.reviewDecision),
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
    a.review === b.review
  )
}
