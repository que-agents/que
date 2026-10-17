import { describe, expect, it } from 'vitest'
import { formatAge, formatCost, formatDuration, formatMinSec, formatSpan, hhmm } from './format'

describe('formatCost', () => {
  it('rounds money to cents', () => {
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(0.30000000000000004)).toBe('$0.30')
    expect(formatCost(1.236)).toBe('$1.24')
  })
})

describe('formatDuration', () => {
  it('formats seconds, minutes and hours, zero-padded by default', () => {
    expect(formatDuration(42_400)).toBe('42s')
    expect(formatDuration(185_000)).toBe('3m 05s')
    expect(formatDuration(7_620_000)).toBe('2h 07m')
    expect(formatDuration(-5)).toBe('0s')
  })

  it('leaves the second unit unpadded when asked', () => {
    expect(formatDuration(185_000, { pad: false })).toBe('3m 5s')
    expect(formatDuration(7_620_000, { pad: false })).toBe('2h 7m')
  })

  it('shows whole minutes only, with seconds under a minute', () => {
    expect(formatDuration(45_600, { seconds: false })).toBe('46s')
    expect(formatDuration(45_600, { seconds: false, floor: true })).toBe('45s')
    expect(formatDuration(12 * 60_000 + 59_000, { seconds: false })).toBe('12m')
    expect(formatDuration(65 * 60_000, { seconds: false })).toBe('1h 05m')
    expect(formatDuration(65 * 60_000, { seconds: false, pad: false })).toBe('1h 5m')
  })
})

describe('formatSpan', () => {
  it('formats the span between two timestamps, empty when either is unknown', () => {
    expect(formatSpan('2026-10-14T01:00:00.000Z', '2026-10-14T01:01:21.000Z')).toBe('1m 21s')
    expect(formatSpan('2026-10-14T01:00:00.000Z', '2026-10-14T01:00:09.400Z')).toBe('9s')
    expect(formatSpan('2026-10-14T01:00:00.000Z', null)).toBe('')
    expect(formatSpan(null, '2026-10-14T01:00:09.000Z')).toBe('')
    expect(formatSpan('not a time', '2026-10-14T01:00:09.000Z')).toBe('')
  })
})

describe('formatAge', () => {
  const now = Date.parse('2026-10-14T08:00:00.000Z')

  it('counts back from now in the largest whole unit, with an optional suffix', () => {
    expect(formatAge('2026-10-14T07:59:18.000Z', now)).toBe('42s')
    expect(formatAge('2026-10-14T07:55:00.000Z', now, ' ago')).toBe('5m ago')
    expect(formatAge('2026-10-14T05:00:00.000Z', now)).toBe('3h')
    expect(formatAge('2026-10-12T08:00:00.000Z', now, ' ago')).toBe('2d ago')
    expect(formatAge(null, now, ' ago')).toBe('-')
  })
})

describe('clock times', () => {
  it('writes local HH:MM and a zero-padded minutes:seconds countdown', () => {
    expect(hhmm(new Date(2026, 9, 14, 7, 5).getTime())).toBe('07:05')
    expect(formatMinSec(303_000)).toBe('05:03')
    expect(formatMinSec(75 * 60_000)).toBe('75:00')
    expect(formatMinSec(-1)).toBe('00:00')
  })
})
