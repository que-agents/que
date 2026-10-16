import { describe, expect, it } from 'vitest'
import { checkRunsOf, parsePullRequest, samePullRequest } from './pr-state'
import { decodeCheckRollup, decodePullRequest } from './pr-state.decode'

const AT = '2026-10-14T03:00:00.000Z'
const base = { number: 7, url: 'https://github.com/rquellh/que/pull/7', title: 'Add retry logic' }

// Each case goes in as `gh` prints it, through the decoder, then the mapping under test.
const parse = (extra: Record<string, unknown>) => {
  const raw = decodePullRequest({ ...base, ...extra })

  return raw && parsePullRequest(raw, AT)
}

const runsOf = (rollup: unknown) => checkRunsOf(decodeCheckRollup(rollup))

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
})

describe('checkRunsOf', () => {
  const run = (extra: Record<string, unknown>) => ({
    __typename: 'CheckRun',
    name: 'build',
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    ...extra
  })

  const ctx = (extra: Record<string, unknown>) => ({
    __typename: 'StatusContext',
    context: 'deploy/preview',
    state: 'SUCCESS',
    ...extra
  })

  it('maps a check run with its workflow, url, and times', () => {
    expect(
      runsOf([
        run({
          name: 'unit tests',
          workflowName: 'CI',
          detailsUrl: 'https://github.com/rquellh/que/actions/runs/11',
          startedAt: '2026-10-14T02:58:00Z',
          completedAt: '2026-10-14T02:59:21Z'
        })
      ])
    ).toEqual([
      {
        name: 'unit tests',
        source: 'CI',
        state: 'passing',
        url: 'https://github.com/rquellh/que/actions/runs/11',
        startedAt: '2026-10-14T02:58:00Z',
        completedAt: '2026-10-14T02:59:21Z'
      }
    ])
  })

  it('maps a settled commit status, its createdAt as the completion time', () => {
    expect(
      runsOf([
        ctx({ targetUrl: 'https://preview.example.com/7', createdAt: '2026-10-14T03:01:00Z' })
      ])
    ).toEqual([
      {
        name: 'deploy/preview',
        source: null,
        state: 'passing',
        url: 'https://preview.example.com/7',
        startedAt: null,
        completedAt: '2026-10-14T03:01:00Z'
      }
    ])
  })

  it('leaves a pending commit status without a completion time, and missing fields null', () => {
    expect(runsOf([ctx({ state: 'PENDING', createdAt: '2026-10-14T03:01:00Z' })])).toEqual([
      {
        name: 'deploy/preview',
        source: null,
        state: 'pending',
        url: null,
        startedAt: null,
        completedAt: null
      }
    ])
  })

  it.each([
    ['QUEUED', null, 'pending'],
    ['IN_PROGRESS', null, 'pending'],
    ['WAITING', null, 'pending'],
    ['COMPLETED', 'SUCCESS', 'passing'],
    ['COMPLETED', 'FAILURE', 'failing'],
    ['COMPLETED', 'CANCELLED', 'failing'],
    ['COMPLETED', 'TIMED_OUT', 'failing'],
    ['COMPLETED', 'ACTION_REQUIRED', 'failing'],
    ['COMPLETED', 'STARTUP_FAILURE', 'failing'],
    ['COMPLETED', 'SKIPPED', 'skipped'],
    ['COMPLETED', 'NEUTRAL', 'skipped'],
    ['COMPLETED', 'STALE', 'skipped'],
    ['COMPLETED', null, 'skipped']
  ])('a check run %s / %s is %s', (status, conclusion, state) => {
    expect(runsOf([run({ status, conclusion })])[0].state).toBe(state)
  })

  it.each([
    ['SUCCESS', 'passing'],
    ['FAILURE', 'failing'],
    ['ERROR', 'failing'],
    ['PENDING', 'pending'],
    ['EXPECTED', 'pending']
  ])('a commit status %s is %s', (state, expected) => {
    expect(runsOf([ctx({ state })])[0].state).toBe(expected)
  })

  it('recognises both shapes without __typename', () => {
    expect(
      runsOf([
        { name: 'lint', status: 'IN_PROGRESS', conclusion: null },
        { context: 'ci/legacy', state: 'ERROR' }
      ]).map((c) => [c.name, c.state])
    ).toEqual([
      ['ci/legacy', 'failing'],
      ['lint', 'pending']
    ])
  })

  it('orders failing, pending, passing, skipped, and by name within each', () => {
    const runs = runsOf([
      run({ name: 'typecheck', conclusion: 'SKIPPED' }),
      run({ name: 'unit tests' }),
      ctx({ context: 'deploy/preview', state: 'PENDING' }),
      run({ name: 'lint', conclusion: 'FAILURE' }),
      run({ name: 'e2e', status: 'IN_PROGRESS', conclusion: null }),
      run({ name: 'build' }),
      ctx({ context: 'coverage', state: 'FAILURE' })
    ])

    expect(runs.map((c) => [c.state, c.name])).toEqual([
      ['failing', 'coverage'],
      ['failing', 'lint'],
      ['pending', 'deploy/preview'],
      ['pending', 'e2e'],
      ['passing', 'build'],
      ['passing', 'unit tests'],
      ['skipped', 'typecheck']
    ])
  })

  it('feeds parsePullRequest, whose summary follows the runs', () => {
    const pr = parse({
      state: 'OPEN',
      statusCheckRollup: [run({ name: 'build' }), ctx({ state: 'PENDING' })]
    })

    expect(pr?.checks).toBe('pending')
    expect(pr?.checkRuns.map((c) => c.name)).toEqual(['deploy/preview', 'build'])
  })

  it('summarises skipped-only runs as passing', () => {
    expect(parse({ statusCheckRollup: [run({ conclusion: 'SKIPPED' })] })?.checks).toBe('passing')
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

  it('tells pull requests apart by their check runs', () => {
    const pending = parse({
      state: 'OPEN',
      statusCheckRollup: [{ name: 'build', status: 'IN_PROGRESS', conclusion: null }]
    })

    const passing = parse({
      state: 'OPEN',
      statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }]
    })

    const otherUrl = parse({
      state: 'OPEN',
      statusCheckRollup: [
        { name: 'build', status: 'IN_PROGRESS', conclusion: null, detailsUrl: 'https://x/2' }
      ]
    })

    expect(samePullRequest(pending, pending && { ...pending, checkedAt: 'later' })).toBe(true)
    expect(samePullRequest(pending, passing)).toBe(false)
    expect(samePullRequest(pending, otherUrl)).toBe(false)
  })

  it('treats null and a value as different, two nulls as the same', () => {
    expect(samePullRequest(null, null)).toBe(true)
    expect(samePullRequest(null, a)).toBe(false)
    expect(samePullRequest(a, null)).toBe(false)
  })
})
