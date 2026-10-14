import { describe, expect, it } from 'vitest'
import { makeTask } from '../testing/fixtures'
import { buildReport, formatDuration, formatReport, parseSince, reportSince } from './report'

const NOW = Date.parse('2026-10-14T07:30:00.000Z')
const SINCE = '2026-10-13T22:00:00.000Z'
const WORKSPACES = new Map([
  ['ws_01hzx3k9c2qf', 'add-retry-logic'],
  ['ws_01hzx4m1p8rt', 'fix-flaky-upload-test']
])

const done = makeTask({
  title: 'Add retry logic to the uploader',
  state: 'done',
  workspaceId: 'ws_01hzx3k9c2qf',
  branch: 'add-retry-logic',
  prUrl: 'https://github.com/rquellh/que/pull/88',
  turns: 14,
  costUsd: 1.82,
  startedAt: '2026-10-13T22:01:00.000Z',
  finishedAt: '2026-10-13T22:43:30.000Z',
  createdAt: '2026-10-13T21:50:00.000Z',
  updatedAt: '2026-10-13T22:43:30.000Z'
})
const stuck = makeTask({
  title: 'Fix the flaky upload test',
  state: 'stuck',
  reason: 'needs_input',
  workspaceId: 'ws_01hzx4m1p8rt',
  branch: 'fix-flaky-upload-test',
  turns: 3,
  costUsd: 0.4,
  startedAt: '2026-10-13T22:01:00.000Z',
  finishedAt: '2026-10-13T22:06:00.000Z',
  createdAt: '2026-10-13T21:51:00.000Z',
  updatedAt: '2026-10-13T22:06:00.000Z'
})
const running = makeTask({
  title: 'Migrate the queue to sqlite',
  state: 'finishing',
  workspaceId: 'ws_missing00000',
  startedAt: '2026-10-14T07:00:00.000Z',
  createdAt: '2026-10-13T21:52:00.000Z',
  updatedAt: '2026-10-14T07:29:00.000Z'
})
const queuedLongAgo = makeTask({
  title: 'Write the changelog',
  workspaceId: null,
  createdAt: '2026-10-10T09:00:00.000Z',
  updatedAt: '2026-10-10T09:00:00.000Z'
})
const oldFailure = makeTask({
  title: 'Old failure',
  state: 'failed',
  reason: 'crashed',
  createdAt: '2026-10-11T09:00:00.000Z',
  updatedAt: '2026-10-11T09:30:00.000Z'
})

describe('buildReport', () => {
  const report = buildReport(
    [running, stuck, oldFailure, done, queuedLongAgo],
    WORKSPACES,
    SINCE,
    NOW
  )

  it('groups what changed since the window opened, plus everything still live', () => {
    expect(report.groups.done.map((e) => e.title)).toEqual(['Add retry logic to the uploader'])
    expect(report.groups.stuck.map((e) => e.title)).toEqual(['Fix the flaky upload test'])
    expect(report.groups.running.map((e) => e.title)).toEqual(['Migrate the queue to sqlite'])
    expect(report.groups.queued.map((e) => e.title)).toEqual(['Write the changelog'])
    expect(report.groups.failed).toEqual([])
    expect(report.since).toBe(SINCE)
    expect(report.generatedAt).toBe('2026-10-14T07:30:00.000Z')
  })

  it('names the workspace, and measures duration to the finish (or to now while live)', () => {
    expect(report.groups.done[0]).toEqual({
      id: done.id,
      title: 'Add retry logic to the uploader',
      state: 'done',
      reason: null,
      workspace: 'add-retry-logic',
      branch: 'add-retry-logic',
      prUrl: 'https://github.com/rquellh/que/pull/88',
      durationMs: 42.5 * 60_000,
      turns: 14,
      costUsd: 1.82
    })
    expect(report.groups.running[0]).toMatchObject({
      workspace: 'ws_missing00000',
      durationMs: 30 * 60_000
    })
    expect(report.groups.queued[0]).toMatchObject({ workspace: null, durationMs: null })
  })

  it('totals tasks, pull requests, turns, cost, and time', () => {
    expect(report.totals).toEqual({
      tasks: 4,
      prs: 1,
      turns: 17,
      costUsd: 2.22,
      durationMs: (42.5 + 5 + 30) * 60_000
    })
  })

  it('renders as text, one block per non-empty group', () => {
    const text = formatReport(report)

    expect(text).toContain(
      'Done (1)\n  Add retry logic to the uploader\n    add-retry-logic · 42m · 14 turns · $1.82\n    https://github.com/rquellh/que/pull/88'
    )
    expect(text).toContain(
      'Stuck (1)\n  Fix the flaky upload test\n    needs_input · fix-flaky-upload-test · 5m · 3 turns · $0.40'
    )
    expect(text).not.toContain('Failed')
    expect(text.trim().split('\n').at(-1)).toBe(
      'Total: 4 tasks · 1 PRs · 17 turns · $2.22 · 1h 17m'
    )
  })

  it('reads done, stuck, failed, paused, running, queued, then stopped, with the unlocks line last-but-one', () => {
    const tasks = (
      ['stopped', 'queued', 'running', 'paused', 'failed', 'stuck', 'done'] as const
    ).map((state, i) =>
      makeTask({
        title: `Task ${state}`,
        state,
        createdAt: `2026-10-13T22:0${i}:00.000Z`,
        updatedAt: `2026-10-13T23:0${i}:00.000Z`
      })
    )

    const text = formatReport(
      buildReport(tasks, WORKSPACES, SINCE, NOW),
      'Unlocked once last night, 20 min total'
    )

    const headings = text.split('\n').filter((l) => /^[A-Z][a-z]+ \(\d+\)$/.test(l))
    expect(headings).toEqual([
      'Done (1)',
      'Stuck (1)',
      'Failed (1)',
      'Paused (1)',
      'Running (1)',
      'Queued (1)',
      'Stopped (1)'
    ])
    expect(text.trim().split('\n').at(-3)).toBe('Unlocked once last night, 20 min total')
  })

  it('says so when the window is empty', () => {
    expect(formatReport(buildReport([], WORKSPACES, SINCE, NOW))).toContain(
      'No tasks in this window.'
    )
  })
})

describe('reportSince', () => {
  it('uses the explicit time, else the last queue open, else 24 hours back', () => {
    expect(reportSince('2026-10-13T20:00:00Z', SINCE, NOW)).toBe('2026-10-13T20:00:00.000Z')
    expect(reportSince(undefined, SINCE, NOW)).toBe(SINCE)
    expect(reportSince(undefined, null, NOW)).toBe('2026-10-13T07:30:00.000Z')
  })
})

describe('formatDuration', () => {
  it.each([
    [null, '-'],
    [0, '0s'],
    [45_900, '45s'],
    [12 * 60_000 + 59_000, '12m'],
    [65 * 60_000, '1h 05m'],
    [26 * 3_600_000, '26h 00m']
  ])('%s ms → %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})

describe('parseSince', () => {
  it('takes a duration back from now or an ISO time', () => {
    expect(parseSince('12h', NOW)).toBe('2026-10-13T19:30:00.000Z')
    expect(parseSince('90m', NOW)).toBe('2026-10-14T06:00:00.000Z')
    expect(parseSince('2d', NOW)).toBe('2026-10-12T07:30:00.000Z')
    expect(parseSince('2026-10-13T22:00:00Z', NOW)).toBe('2026-10-13T22:00:00.000Z')
  })

  it('rejects anything else', () => {
    expect(parseSince('yesterday', NOW)).toBeNull()
  })
})
