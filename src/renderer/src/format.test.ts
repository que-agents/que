import { describe, expect, it } from 'vitest'
import { makeTask } from '@renderer/testing/fixtures'
import {
  formatCost,
  formatDuration,
  isLiveTask,
  newestFirst,
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
