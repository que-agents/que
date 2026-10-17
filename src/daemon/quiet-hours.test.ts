import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCountdown } from '../shared/format'
import { makeQuietHours } from '../testing/fixtures'
import {
  currentWindow,
  effectiveConfig,
  formatUnlocks,
  isQuiet,
  nextBoundary,
  quietMessage,
  remaining,
  shortensTonight
} from './quiet-hours'

// Quiet hours are local wall-clock time: build dates with the local
// constructor, never ISO strings ending in Z. October 2026: Mon 12 … Sun 18.
const at = (day: number, h: number, m = 0, month = 9): Date => new Date(2026, month, day, h, m)
const ms = (day: number, h: number, m = 0, month = 9): number => at(day, h, m, month).getTime()

describe('currentWindow', () => {
  describe('clock', () => {
    it('handles a window that crosses midnight', () => {
      const cfg = makeQuietHours({ default: { start: '19:00', end: '07:00' } })

      expect(currentWindow(ms(13, 18, 59), cfg)).toBeNull()
      expect(currentWindow(ms(13, 19, 0), cfg)).toEqual({
        start: at(13, 19),
        end: at(14, 7),
        weekday: 'tuesday'
      })
      expect(isQuiet(ms(13, 23, 30), cfg)).toBe(true)
      expect(isQuiet(ms(14, 6, 59), cfg)).toBe(true)
      expect(isQuiet(ms(14, 7, 0), cfg)).toBe(false)
    })

    it('belongs to the weekday it started on, even after midnight', () => {
      const cfg = makeQuietHours()

      const w = currentWindow(ms(14, 2, 0), cfg)

      expect(w).toEqual({ start: at(13, 19), end: at(14, 7), weekday: 'tuesday' })
    })

    it('lets a per-day override replace the default window', () => {
      const cfg = makeQuietHours({ days: { monday: { start: '21:30', end: '06:00' } } })

      expect(isQuiet(ms(12, 20, 0), cfg)).toBe(false) // Monday evening, before 21:30
      expect(currentWindow(ms(12, 22, 0), cfg)).toEqual({
        start: at(12, 21, 30),
        end: at(13, 6),
        weekday: 'monday'
      })
      expect(isQuiet(ms(13, 6, 30), cfg)).toBe(false) // Monday's window ended at 06:00
      expect(isQuiet(ms(13, 20, 0), cfg)).toBe(true) // Tuesday is back on the default
    })

    it('has no window on a day set to none, but the night before still runs into it', () => {
      const cfg = makeQuietHours({ days: { saturday: 'none' } })

      expect(isQuiet(ms(17, 6, 0), cfg)).toBe(true) // Friday's window, Saturday morning
      expect(isQuiet(ms(17, 22, 0), cfg)).toBe(false) // Saturday night: none
      expect(isQuiet(ms(18, 3, 0), cfg)).toBe(false)
      expect(isQuiet(ms(18, 20, 0), cfg)).toBe(true) // Sunday is quiet again
    })

    it('supports a daytime window that does not cross midnight', () => {
      const cfg = makeQuietHours({ days: { wednesday: { start: '12:00', end: '13:30' } } })

      expect(currentWindow(ms(14, 12, 45), cfg)).toEqual({
        start: at(14, 12),
        end: at(14, 13, 30),
        weekday: 'wednesday'
      })
      expect(isQuiet(ms(14, 13, 30), cfg)).toBe(false)
    })

    it('is never quiet when quiet hours are off', () => {
      const cfg = makeQuietHours({ enabled: false })

      expect(currentWindow(ms(13, 23, 0), cfg)).toBeNull()
      expect(nextBoundary(ms(13, 23, 0), cfg)).toBeNull()
    })
  })

  describe('DST', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('keeps the wall-clock end on the night clocks fall back (13 hours long)', () => {
      vi.stubEnv('TZ', 'America/New_York')
      const cfg = makeQuietHours()

      const w = currentWindow(ms(1, 6, 30, 10), cfg) // Sun 1 Nov 2026, after the change

      expect(w?.start).toEqual(at(31, 19))
      expect(w?.end).toEqual(at(1, 7, 0, 10))
      expect(((w?.end.getTime() ?? 0) - (w?.start.getTime() ?? 0)) / 3_600_000).toBe(13)
    })

    it('keeps the wall-clock end on the night clocks spring forward (11 hours long)', () => {
      vi.stubEnv('TZ', 'America/New_York')
      const cfg = makeQuietHours()

      const w = currentWindow(ms(8, 6, 30, 2), cfg) // Sun 8 Mar 2026

      expect(w?.end).toEqual(at(8, 7, 0, 2))
      expect(((w?.end.getTime() ?? 0) - (w?.start.getTime() ?? 0)) / 3_600_000).toBe(11)
      expect(nextBoundary(ms(8, 3, 0, 2), cfg)).toEqual(at(8, 7, 0, 2))
    })
  })
})

describe('nextBoundary', () => {
  it('is the end of the window in progress', () => {
    expect(nextBoundary(ms(13, 23, 0), makeQuietHours())).toEqual(at(14, 7))
  })

  it("is today's start during work hours", () => {
    expect(nextBoundary(ms(14, 9, 0), makeQuietHours())).toEqual(at(14, 19))
  })

  it('skips days set to none', () => {
    const cfg = makeQuietHours({ days: { saturday: 'none' } })

    expect(nextBoundary(ms(17, 9, 0), cfg)).toEqual(at(18, 19)) // Saturday → Sunday 19:00
  })
})

describe('remaining', () => {
  const unlock = { until: at(14, 2, 20), startedAt: at(14, 2, 0) }

  it('counts down to the unlock deadline', () => {
    expect(remaining(ms(14, 2, 5), unlock)).toBe(15 * 60_000)
    expect(formatCountdown(remaining(ms(14, 2, 5), unlock))).toBe('15:00')
  })

  it('is zero once the unlock expired, or with no unlock', () => {
    expect(remaining(ms(14, 2, 20), unlock)).toBe(0)
    expect(remaining(ms(14, 3, 0), unlock)).toBe(0)
    expect(remaining(ms(14, 2, 5), { until: null, startedAt: null })).toBe(0)
  })
})

describe('effectiveConfig (the apply-tonight guardrail)', () => {
  const tonight = makeQuietHours({ default: { start: '19:00', end: '07:00' } })
  const earlier = makeQuietHours({ default: { start: '19:00', end: '05:00' } })
  const later = makeQuietHours({ default: { start: '19:00', end: '08:00' } })
  const off = makeQuietHours({ enabled: false })

  it("keeps tonight's window when the edit would shorten it and applyTonight is false", () => {
    expect(effectiveConfig(ms(14, 2, 0), tonight, earlier, false)).toBe(tonight)
    expect(shortensTonight(ms(14, 2, 0), tonight, earlier)).toBe(true)
  })

  it("keeps tonight's window when the edit would remove it", () => {
    expect(effectiveConfig(ms(14, 2, 0), tonight, off, false)).toBe(tonight)
  })

  it('applies a shortening edit tonight when asked to', () => {
    expect(effectiveConfig(ms(14, 2, 0), tonight, earlier, true)).toBe(earlier)
  })

  it('applies an edit that lengthens tonight at once', () => {
    expect(effectiveConfig(ms(14, 2, 0), tonight, later, false)).toBe(later)
    expect(shortensTonight(ms(14, 2, 0), tonight, later)).toBe(false)
  })

  it('applies any edit at once outside quiet hours', () => {
    expect(effectiveConfig(ms(14, 12, 0), tonight, earlier, false)).toBe(earlier)
    expect(effectiveConfig(ms(14, 12, 0), tonight, off, false)).toBe(off)
  })
})

describe('formatUnlocks', () => {
  it('says so when nothing was unlocked', () => {
    expect(formatUnlocks([], ms(14, 8, 0))).toBe('No unlocks')
  })

  it('adds up the minutes actually unlocked, counting an early lock', () => {
    const unlocks = [
      {
        at: at(13, 23, 0).toISOString(),
        minutes: 20,
        why: 'check the deploy',
        endedAt: at(13, 23, 20).toISOString()
      },
      {
        at: at(14, 2, 0).toISOString(),
        minutes: 20,
        why: null,
        endedAt: at(14, 2, 11).toISOString()
      }
    ]

    expect(formatUnlocks(unlocks, ms(14, 8, 0))).toBe('Unlocked twice last night, 31 min total')
    expect(formatUnlocks(unlocks.slice(0, 1), ms(14, 8, 0))).toBe(
      'Unlocked once last night, 20 min total'
    )
  })
})

describe('quietMessage', () => {
  it('names the end of the window and the unlock command', () => {
    expect(quietMessage(ms(14, 7, 0), 20)).toBe(
      'quiet hours until 07:00; run `que unlock` for 20 minutes'
    )
  })
})
