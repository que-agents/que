import { describe, expect, it } from 'vitest'
import { parsePullRequest, samePullRequest } from './pr-state'

const AT = '2026-10-14T03:00:00.000Z'
const base = { number: 7, url: 'https://github.com/rquellh/que/pull/7', title: 'Add retry logic' }
const parse = (extra: Record<string, unknown>) => parsePullRequest({ ...base, ...extra }, AT)

describe('parsePullRequest', () => {
  it('maps a plain open pull request', () => {
    expect(parse({ state: 'OPEN', isDraft: false })).toEqual({
      ...base,
      state: 'open',
      checks: 'none',
      review: null,
      checkRuns: [],
      updatedAt: null,
      checkedAt: AT
    })
  })

  it.each([
    [{ state: 'OPEN', isDraft: true }, 'draft'],
    [{ state: 'OPEN', isDraft: false }, 'open'],
    [{ state: 'CLOSED', isDraft: false }, 'closed'],
    [{ state: 'MERGED' }, 'merged'],
    [{ state: 'CLOSED', mergedAt: '2026-10-14T01:00:00Z' }, 'merged'],
    [{ state: 'CLOSED', isDraft: true }, 'closed']
  ])('state from %j is %s', (extra, state) => {
    expect(parse(extra)?.state).toBe(state)
  })

  it.each([
    [undefined, 'none'],
    [[], 'none'],
    [[{ status: 'COMPLETED', conclusion: 'SUCCESS' }], 'passing'],
    [[{ status: 'COMPLETED', conclusion: 'SKIPPED' }, { state: 'SUCCESS' }], 'passing'],
    [[{ status: 'COMPLETED', conclusion: 'FAILURE' }], 'failing'],
    [[{ status: 'COMPLETED', conclusion: 'CANCELLED' }], 'failing'],
    [[{ status: 'COMPLETED', conclusion: 'TIMED_OUT' }], 'failing'],
    [[{ status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' }], 'failing'],
    [[{ status: 'COMPLETED', conclusion: 'STARTUP_FAILURE' }], 'failing'],
    [[{ state: 'FAILURE' }], 'failing'],
    [[{ state: 'ERROR' }], 'failing'],
    [[{ status: 'IN_PROGRESS', conclusion: '' }], 'pending'],
    [[{ status: 'QUEUED' }], 'pending'],
    [[{ state: 'PENDING' }], 'pending'],
    [[{ state: 'EXPECTED' }], 'pending'],
    [[{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }], 'failing']
  ])('checks from %j is %s', (statusCheckRollup, checks) => {
    expect(parse({ state: 'OPEN', statusCheckRollup })?.checks).toBe(checks)
  })

  it.each([
    ['APPROVED', 'approved'],
    ['CHANGES_REQUESTED', 'changes_requested'],
    ['REVIEW_REQUIRED', 'review_required'],
    ['', null],
    [null, null],
    ['SOMETHING_NEW', null]
  ])('review from %j is %s', (reviewDecision, review) => {
    expect(parse({ state: 'OPEN', reviewDecision })?.review).toBe(review)
  })

  it.each([
    [null],
    ['text'],
    [{ url: base.url }],
    [{ number: 1 }],
    [{ number: '1', url: base.url }]
  ])('returns null for %j', (raw) => {
    expect(parsePullRequest(raw, AT)).toBeNull()
  })
})

describe('samePullRequest', () => {
  const a = parse({ state: 'OPEN' })

  it('ignores checkedAt only', () => {
    expect(samePullRequest(a, a && { ...a, checkedAt: 'later' })).toBe(true)
    expect(samePullRequest(a, parse({ state: 'OPEN', isDraft: true }))).toBe(false)
    expect(samePullRequest(a, parse({ state: 'OPEN', reviewDecision: 'APPROVED' }))).toBe(false)
    expect(samePullRequest(a, parse({ state: 'OPEN', title: 'New title' }))).toBe(false)
  })

  it('treats null and a value as different, two nulls as the same', () => {
    expect(samePullRequest(null, null)).toBe(true)
    expect(samePullRequest(null, a)).toBe(false)
    expect(samePullRequest(a, null)).toBe(false)
  })
})
