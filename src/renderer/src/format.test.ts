import { describe, expect, it } from 'vitest'
import { makePullRequest, makeTask } from '@renderer/testing/fixtures'
import {
  formatCost,
  formatDuration,
  isLiveTask,
  newestFirst,
  prBadge,
  statusBadge,
  taskBadge
} from './format'

describe('badges', () => {
  it('labels every workspace status with a tone', () => {
    expect(statusBadge('needs_input')).toEqual({ label: 'needs input', tone: 'attention' })
    expect(statusBadge('stuck')).toEqual({ label: 'stuck', tone: 'bad' })
    expect(statusBadge('working').tone).toBe('busy')
  })

  it('labels task states and knows which can still be stopped', () => {
    expect(taskBadge('done')).toEqual({ label: 'done', tone: 'good' })
    expect(isLiveTask('paused')).toBe(true)
    expect(isLiveTask('finishing')).toBe(true)
    expect(isLiveTask('done')).toBe(false)
    expect(isLiveTask('stopped')).toBe(false)
  })
})

describe('formatCost and formatDuration', () => {
  it('rounds money to cents', () => {
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(0.30000000000000004)).toBe('$0.30')
    expect(formatCost(1.236)).toBe('$1.24')
  })

  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(42_400)).toBe('42s')
    expect(formatDuration(185_000)).toBe('3m 05s')
    expect(formatDuration(7_620_000)).toBe('2h 07m')
    expect(formatDuration(-5)).toBe('0s')
  })

  it('formats the span between two timestamps, empty when either is unknown', () => {
    expect(formatDuration('2026-10-14T01:00:00.000Z', '2026-10-14T01:01:21.000Z')).toBe('1m 21s')
    expect(formatDuration('2026-10-14T01:00:00.000Z', '2026-10-14T01:00:09.400Z')).toBe('9s')
    expect(formatDuration('2026-10-14T01:00:00.000Z', null)).toBe('')
    expect(formatDuration(null, '2026-10-14T01:00:09.000Z')).toBe('')
    expect(formatDuration('not a time', '2026-10-14T01:00:09.000Z')).toBe('')
  })
})

describe('newestFirst', () => {
  it('orders by creation time, newest first, without mutating its input', () => {
    const older = makeTask({ createdAt: '2026-10-13T21:05:00.000Z' })
    const newer = makeTask({ createdAt: '2026-10-13T22:40:00.000Z' })
    const input = [older, newer]

    expect(newestFirst(input).map((t) => t.id)).toEqual([newer.id, older.id])
    expect(input.map((t) => t.id)).toEqual([older.id, newer.id])
  })
})

describe('prBadge', () => {
  it.each([
    [{ state: 'merged' }, 'good', 'PR #41: merged'],
    [{ state: 'closed' }, 'muted', 'PR #41: closed'],
    [{ state: 'closed', checks: 'failing' }, 'muted', 'PR #41: closed, checks failing'],
    [{ state: 'draft' }, 'neutral', 'PR #41: draft'],
    [{ state: 'draft', checks: 'pending' }, 'neutral', 'PR #41: draft, checks pending'],
    [{ state: 'draft', checks: 'failing' }, 'bad', 'PR #41: draft, checks failing'],
    [{ state: 'open', checks: 'failing' }, 'bad', 'PR #41: open, checks failing'],
    [
      { state: 'open', checks: 'failing', review: 'changes_requested' },
      'bad',
      'PR #41: open, checks failing, changes requested'
    ],
    [
      { state: 'open', checks: 'passing', review: 'changes_requested' },
      'attention',
      'PR #41: open, checks passing, changes requested'
    ],
    [
      { state: 'open', checks: 'passing', review: 'approved' },
      'good',
      'PR #41: open, checks passing, approved'
    ],
    [{ state: 'open', checks: 'none', review: 'approved' }, 'good', 'PR #41: open, approved'],
    [
      { state: 'open', checks: 'pending', review: 'approved' },
      'busy',
      'PR #41: open, checks pending, approved'
    ],
    [
      { state: 'open', checks: 'passing', review: 'review_required' },
      'busy',
      'PR #41: open, checks passing, review required'
    ],
    [{ state: 'open', checks: 'passing' }, 'busy', 'PR #41: open, checks passing'],
    [{ state: 'open' }, 'busy', 'PR #41: open']
  ] as const)('%j is %s: "%s"', (overrides, tone, title) => {
    expect(prBadge(makePullRequest(overrides))).toEqual({ label: '#41', tone, title })
  })
})
