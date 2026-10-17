import { describe, expect, it } from 'vitest'
import { makePullRequest, makeTask } from '@renderer/testing/fixtures'
import { isLiveTask, newestFirst, prBadge, statusBadge, taskBadge } from './format'

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
