import { describe, expect, it } from 'vitest'
import type { WorkspaceDigest } from '../shared/protocol'
import type { PullRequest } from '../shared/types'
import {
  buildReport,
  digestFacts,
  formatDuration,
  formatReport,
  nothingRanLine,
  parseSince,
  reportCountItems,
  reportSince,
  reportSummaryText,
  summaryNotification
} from './report'
import { countLineText } from '../shared/count-line'

const NOW = Date.parse('2026-10-14T07:30:00.000Z')
const SINCE = '2026-10-13T22:00:00.000Z'
const WAITING = new Date(2026, 9, 14, 2, 5).toISOString()

const digest = (over: Partial<WorkspaceDigest>): WorkspaceDigest => ({
  id: 'ws_01hzx3k9c2qf',
  name: 'app-1432-retry-logic',
  project: 'uploader',
  branch: 'app-1432-retry-logic',
  status: 'idle',
  statusReason: null,
  firstActivityAt: null,
  lastActivityAt: null,
  workingMs: 0,
  needsInputCount: 0,
  waitingSince: null,
  stuckCount: 0,
  commitsAhead: null,
  pr: null,
  sessionId: null,
  ...over
})

const pr = (over: Partial<PullRequest>): PullRequest => ({
  url: 'https://github.com/rquellh/que/pull/12',
  number: 12,
  title: 'Retry the upload on a dropped connection',
  state: 'draft',
  checks: 'failing',
  review: null,
  checkRuns: [],
  updatedAt: null,
  additions: null,
  deletions: null,
  checkedAt: '2026-10-14T02:00:00.000Z',
  ...over
})

const waiting = digest({
  status: 'needs_input',
  workingMs: 72 * 60_000,
  needsInputCount: 2,
  waitingSince: WAITING,
  commitsAhead: 4
})

const stuck = digest({
  id: 'ws_01hzx4m1p8rt',
  name: 'fix-flaky-upload-test',
  status: 'stuck',
  statusReason: 'no_heartbeat',
  pr: pr({})
})

const worked = digest({
  id: 'ws_01hzx5n7d3vb',
  name: 'migrate-queue-sqlite',
  status: 'idle',
  workingMs: 23 * 60_000,
  commitsAhead: 2,
  pr: pr({ number: 13, url: 'https://github.com/rquellh/que/pull/13', state: 'open' })
})

const empty = buildReport([], SINCE, NOW)

describe('buildReport', () => {
  const report = buildReport([waiting, stuck], SINCE, NOW)

  it('keeps the digests in the order given, with the window and when it was made', () => {
    expect(report.workspaces).toEqual([waiting, stuck])
    expect(report.since).toBe(SINCE)
    expect(report.generatedAt).toBe('2026-10-14T07:30:00.000Z')
  })

  it('totals the workspaces and the ones waiting for input', () => {
    expect(report.totals).toEqual({ workspaces: 2, needsInput: 1 })
    expect(empty.totals).toEqual({ workspaces: 0, needsInput: 0 })
  })
})

describe('formatReport', () => {
  it('prints the count line, a block per workspace, then the unlocks line', () => {
    const text = formatReport(buildReport([waiting, stuck], SINCE, NOW), 'Unlocked once')

    expect(text.split('\n')).toEqual([
      `que report since ${SINCE}`,
      '2 sessions · 1 stuck · 1 needs input · 1 PR open · worked 1h 12m',
      '',
      'Workspaces (2)',
      '  app-1432-retry-logic · uploader · needs_input',
      '    worked 1h 12m · asked for input 2× · waiting since 02:05 · 4 commits ahead',
      '  fix-flaky-upload-test · uploader · stuck (no_heartbeat)',
      '    no work in this window · PR #12 draft, checks failing',
      '',
      'Unlocked once'
    ])
  })

  it('says nothing ran when the window is empty, and mentions no tasks', () => {
    const text = formatReport(empty)

    expect(text.split('\n')[1]).toMatch(/^nothing ran since \d\d:\d\d/)
    expect(text).not.toContain('Workspaces')
    expect(text).not.toMatch(/task/i)
  })
})

describe('digestFacts', () => {
  it('lists the facts of each digest, leaving out the ones it has none for', () => {
    expect(digestFacts(waiting)).toEqual([
      'worked 1h 12m',
      'asked for input 2×',
      'waiting since 02:05',
      '4 commits ahead'
    ])
    expect(digestFacts(stuck)).toEqual(['no work in this window', 'PR #12 draft, checks failing'])
  })
})

describe('reportCountItems', () => {
  it('reads sessions, stuck, needs input, open PRs, then the time worked', () => {
    const items = reportCountItems(buildReport([waiting, stuck, worked], SINCE, NOW))

    expect(items.map((i) => i.label)).toEqual([
      'sessions',
      'stuck',
      'needs input',
      'PRs open',
      'worked'
    ])
    expect(items.map((i) => i.tone)).toEqual(['muted', 'bad', 'attention', undefined, undefined])
    expect(countLineText(items)).toBe(
      '3 sessions · 1 stuck · 1 needs input · 2 PRs open · worked 1h 35m'
    )
  })

  it('leaves the zeros out and writes one session and one PR in the singular', () => {
    expect(countLineText(reportCountItems(buildReport([worked], SINCE, NOW)))).toBe(
      '1 session · 1 PR open · worked 23m'
    )
  })

  it('counts only the pull requests still open or in draft', () => {
    const merged = digest({ id: 'ws_m', pr: pr({ state: 'merged' }) })
    const closed = digest({ id: 'ws_c', pr: pr({ state: 'closed' }) })

    expect(countLineText(reportCountItems(buildReport([merged, closed], SINCE, NOW)))).toBe(
      '2 sessions'
    )
  })

  it('has no items when nothing ran', () => {
    expect(reportCountItems(empty)).toEqual([])
  })
})

describe('nothingRanLine', () => {
  it('says nothing ran since the window opened', () => {
    const since = new Date(2026, 9, 13, 19, 0).toISOString()

    expect(nothingRanLine({ since }, new Date(2026, 9, 14, 7, 30).getTime())).toBe(
      'nothing ran since 19:00 yesterday'
    )
  })
})

describe('reportSummaryText', () => {
  it('is the count line in plain words, or nothing ran when it is empty', () => {
    expect(reportSummaryText(buildReport([waiting, stuck], SINCE, NOW), NOW)).toBe(
      '2 sessions · 1 stuck · 1 needs input · 1 PR open · worked 1h 12m'
    )
    expect(reportSummaryText(empty, NOW)).toMatch(/^nothing ran since \d\d:\d\d/)
  })
})

describe('summaryNotification', () => {
  it('says good morning after quiet hours, even when nothing ran', () => {
    expect(summaryNotification('scheduled', empty, NOW)).toEqual({
      title: 'que · good morning',
      body: reportSummaryText(empty, NOW)
    })
  })

  it('ends an empty manual quiet silently', () => {
    expect(summaryNotification('manual', empty, NOW)).toBeNull()
  })

  it('says quiet ended after a manual quiet in which a session ran', () => {
    expect(summaryNotification('manual', buildReport([worked], SINCE, NOW), NOW)).toEqual({
      title: 'que · quiet ended',
      body: '1 session · 1 PR open · worked 23m'
    })
  })
})

describe('reportSince', () => {
  it('uses the explicit time, else 24 hours back', () => {
    expect(reportSince('2026-10-13T20:00:00Z', NOW)).toBe('2026-10-13T20:00:00.000Z')
    expect(reportSince(undefined, NOW)).toBe('2026-10-13T07:30:00.000Z')
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
