import { describe, expect, it } from 'vitest'
import { formatUntil, formatUntilShort, formatUsage, formatWeekdayClock, usageTone } from './usage'

// Local wall-clock times: Tue 27 Oct 2026, 14:08.
const at = (day: number, h: number, m = 0, s = 0) => new Date(2026, 9, day, h, m, s).getTime()
const NOW = at(27, 14, 8)

describe('formatUntil', () => {
  it('reads hours and minutes, minutes alone under an hour, days and hours past a day', () => {
    expect(formatUntil(at(27, 16, 18), NOW)).toBe('in 2h 10m')
    expect(formatUntil(at(27, 14, 53), NOW)).toBe('in 45m')
    expect(formatUntil(at(30, 18, 8), NOW)).toBe('in 3d 4h')
  })

  it('rounds down to the minute, and says so under one', () => {
    expect(formatUntil(at(27, 16, 18, 59), NOW)).toBe('in 2h 10m')
    expect(formatUntil(at(27, 14, 8, 30), NOW)).toBe('in <1m')
  })

  it('is now once the time has passed', () => {
    expect(formatUntil(NOW, NOW)).toBe('now')
    expect(formatUntil(at(27, 13, 0), NOW)).toBe('now')
  })
})

describe('formatUntilShort', () => {
  it('leaves out the in: minutes alone under an hour, hours and minutes, days and hours', () => {
    expect(formatUntilShort(at(27, 14, 46), NOW)).toBe('38m')
    expect(formatUntilShort(at(27, 16, 18), NOW)).toBe('2h 10m')
    expect(formatUntilShort(at(30, 18, 8), NOW)).toBe('3d 4h')
  })

  it('reads <1m under a minute and now once the time has passed', () => {
    expect(formatUntilShort(at(27, 14, 8, 30), NOW)).toBe('<1m')
    expect(formatUntilShort(at(27, 13, 0), NOW)).toBe('now')
  })
})

describe('usageTone', () => {
  const tone = (pct: number) => usageTone({ pct, resetsAt: at(27, 16, 20) })

  it('has no tone below 80%', () => {
    expect(tone(0)).toBeNull()
    expect(tone(79)).toBeNull()
  })

  it('is attention from 80% up to 99%', () => {
    expect(tone(80)).toBe('attention')
    expect(tone(99)).toBe('attention')
  })

  it('is bad at 100% and over', () => {
    expect(tone(100)).toBe('bad')
    expect(tone(104)).toBe('bad')
  })

  it('reads the whole percentage shown, so a window that reads 80% or 100% takes its tone', () => {
    expect(tone(79.4)).toBeNull()
    expect(tone(79.5)).toBe('attention')
    expect(tone(99.5)).toBe('bad')
  })
})

describe('formatWeekdayClock', () => {
  it('names the weekday and the local clock', () => {
    expect(formatWeekdayClock(at(2, 21, 45))).toBe('Fri 21:45')
    expect(formatWeekdayClock(new Date(2026, 10, 2, 9, 0).getTime())).toBe('Mon 09:00')
  })
})

describe('formatUsage', () => {
  const reading = {
    fiveHour: { pct: 42.4, resetsAt: at(27, 16, 20) },
    sevenDay: { pct: 17.6, resetsAt: new Date(2026, 10, 2, 9, 0).getTime() },
    at: NOW,
    workspaceId: 'ws_01hzx3k9c2qf'
  }

  it('prints both windows and the reading it came from, percentages whole', () => {
    expect(formatUsage(reading, NOW, 'silver-gentle-pumpkin')).toEqual([
      '5h  42%  resets 16:20 (in 2h 12m)',
      'wk  18%  resets Mon 09:00',
      'as of 14:08 · silver-gentle-pumpkin'
    ])
  })

  it('aligns one- and three-digit percentages, and leaves out an unknown workspace', () => {
    expect(
      formatUsage(
        {
          fiveHour: { pct: 100, resetsAt: at(27, 16, 20) },
          sevenDay: { ...reading.sevenDay, pct: 3 },
          at: NOW
        },
        NOW
      )
    ).toEqual(['5h 100%  resets 16:20 (in 2h 12m)', 'wk   3%  resets Mon 09:00', 'as of 14:08'])
  })

  it('prints only the windows the reading has', () => {
    expect(formatUsage({ sevenDay: reading.sevenDay, at: NOW }, NOW)).toEqual([
      'wk  18%  resets Mon 09:00',
      'as of 14:08'
    ])
  })

  it('says there is no reading yet', () => {
    expect(formatUsage(null, NOW)).toEqual(['no reading yet'])
  })
})
