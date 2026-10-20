import { describe, expect, it } from 'vitest'
import type { QuietState } from '../shared/types'
import { describeQuietState } from './quiet'

// Local wall-clock times: Tuesday 13 Oct 2026, a manual quiet from 14:00 to 15:00.
const at = (h: number, m = 0, s = 0): number => new Date(2026, 9, 13, h, m, s).getTime()

const manual = (overrides: Partial<QuietState> = {}): QuietState => ({
  enabled: true,
  inQuietHours: true,
  kind: 'manual',
  windowStart: new Date(at(14)).toISOString(),
  windowEnd: new Date(at(15)).toISOString(),
  nextBoundary: new Date(at(15)).toISOString(),
  unlockedUntil: null,
  unlockMinutes: 20,
  locked: true,
  ...overrides
})

describe('describeQuietState', () => {
  it('says until when a manual quiet lasts', () => {
    expect(describeQuietState(manual(), at(14, 10))).toBe('quiet until 15:00')
  })

  it('adds the unlock countdown during a manual quiet', () => {
    const unlocked = manual({ unlockedUntil: new Date(at(14, 30)).toISOString(), locked: false })

    expect(describeQuietState(unlocked, at(14, 10, 30))).toBe(
      'quiet until 15:00 · unlocked, 19:30 left'
    )
  })

  it('describes a manual quiet with quiet hours off by its window, not as off', () => {
    expect(describeQuietState(manual({ enabled: false }), at(14, 10))).toBe('quiet until 15:00')
  })
})
