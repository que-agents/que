import { describe, expect, it } from 'vitest'
import { makeQuietState, makeUserConfig } from '@renderer/testing/fixtures'
import { shouldChime } from './sound'

const workHours = makeQuietState({ inQuietHours: false })
const quiet = makeQuietState({
  inQuietHours: true,
  windowStart: new Date(2026, 9, 13, 19, 0).toISOString(),
  windowEnd: new Date(2026, 9, 14, 7, 0).toISOString()
})
const unlocked = { ...quiet, unlockedUntil: new Date(2026, 9, 14, 2, 20).toISOString() }
const defaults = makeUserConfig().notifications

describe('shouldChime', () => {
  it('chimes for a finished task in work hours', () => {
    expect(shouldChime({ state: 'done' }, workHours, defaults)).toBe('complete')
  })

  it('never chimes during quiet hours, unlocked or not', () => {
    expect(shouldChime({ state: 'done' }, quiet, defaults)).toBeNull()
    expect(shouldChime({ state: 'done' }, unlocked, defaults)).toBeNull()
  })

  it('chimes for needing input only when that is turned on', () => {
    const needsInput = { state: 'stuck', reason: 'needs_input' }

    expect(shouldChime(needsInput, workHours, defaults)).toBeNull()
    expect(shouldChime(needsInput, workHours, { ...defaults, chimeOnNeedsInput: true })).toBe(
      'needs_input'
    )
    expect(
      shouldChime({ state: 'needs_input' }, workHours, { ...defaults, chimeOnNeedsInput: true })
    ).toBe('needs_input')
  })

  it('stays silent for other states, with the chime off, or before state has loaded', () => {
    expect(shouldChime({ state: 'running' }, workHours, defaults)).toBeNull()
    expect(shouldChime({ state: 'stuck', reason: 'max_turns' }, workHours, defaults)).toBeNull()
    expect(
      shouldChime({ state: 'done' }, workHours, { ...defaults, chimeOnComplete: false })
    ).toBeNull()
    expect(shouldChime({ state: 'done' }, null, defaults)).toBeNull()
    expect(shouldChime({ state: 'done' }, workHours, undefined)).toBeNull()
  })
})
