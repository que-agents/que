import { describe, expect, it } from 'vitest'
import { makeQuietState, makeUserConfig } from '@renderer/testing/fixtures'
import { shouldChime } from './sound'

const workHours = makeQuietState({ inQuietHours: false })

const quiet = makeQuietState({
  inQuietHours: true,
  windowStart: new Date(2026, 9, 13, 19, 0).toISOString(),
  windowEnd: new Date(2026, 9, 14, 7, 0).toISOString()
})

const manual = makeQuietState({ ...quiet, kind: 'manual' })
const unlocked = { ...quiet, unlockedUntil: new Date(2026, 9, 14, 2, 20).toISOString() }
const defaults = makeUserConfig().notifications
const manualChime = { ...defaults, chimeInManualQuiet: true }

describe('shouldChime', () => {
  it('chimes when a session finishes a turn in work hours', () => {
    expect(shouldChime({ state: 'idle', prev: 'working' }, workHours, defaults)).toBe('complete')
    expect(shouldChime({ state: 'idle', prev: 'needs_input' }, workHours, defaults)).toBe(
      'complete'
    )
    expect(shouldChime({ state: 'idle', prev: 'stuck' }, workHours, defaults)).toBe('complete')
  })

  it('stays silent for idle that does not end a turn', () => {
    expect(shouldChime({ state: 'idle', prev: 'idle' }, workHours, defaults)).toBeNull()
    expect(shouldChime({ state: 'idle', prev: 'preparing' }, workHours, defaults)).toBeNull()
    expect(shouldChime({ state: 'idle', prev: 'exited' }, workHours, defaults)).toBeNull()
    expect(shouldChime({ state: 'idle' }, workHours, defaults)).toBeNull()
    expect(shouldChime({ state: 'idle', prev: null }, workHours, defaults)).toBeNull()
  })

  it('stays silent for a finished turn in quiet hours, unlocked or not, or with the chime off', () => {
    const turnEnded = { state: 'idle', prev: 'working' }

    expect(shouldChime(turnEnded, quiet, defaults)).toBeNull()
    expect(shouldChime(turnEnded, unlocked, defaults)).toBeNull()
    expect(shouldChime(turnEnded, workHours, { ...defaults, chimeOnComplete: false })).toBeNull()
  })

  it('chimes for needing input only when that is turned on', () => {
    expect(shouldChime({ state: 'needs_input' }, workHours, defaults)).toBeNull()
    expect(
      shouldChime({ state: 'needs_input' }, workHours, { ...defaults, chimeOnNeedsInput: true })
    ).toBe('needs_input')
  })

  it('stays silent for other states, with the chime off, or before state has loaded', () => {
    const turnEnded = { state: 'idle', prev: 'working' }

    expect(shouldChime({ state: 'working', prev: 'idle' }, workHours, defaults)).toBeNull()
    expect(shouldChime({ state: 'stuck', prev: 'working' }, workHours, defaults)).toBeNull()
    expect(shouldChime(turnEnded, null, defaults)).toBeNull()
    expect(shouldChime(turnEnded, workHours, undefined)).toBeNull()
  })

  describe('in a manual quiet', () => {
    it('plays the complete chime when chime_in_manual_quiet is on', () => {
      expect(shouldChime({ state: 'idle', prev: 'working' }, manual, manualChime)).toBe('complete')
    })

    it('never plays the needs-input chime, whatever the toggles say', () => {
      const both = { ...manualChime, chimeOnNeedsInput: true }

      expect(shouldChime({ state: 'needs_input' }, manual, both)).toBeNull()
    })

    it('stays silent with chime_in_manual_quiet off, or chime_on_complete off', () => {
      expect(shouldChime({ state: 'idle', prev: 'working' }, manual, defaults)).toBeNull()
      expect(
        shouldChime({ state: 'idle', prev: 'working' }, manual, {
          ...manualChime,
          chimeOnComplete: false
        })
      ).toBeNull()
    })

    it('leaves scheduled quiet hours silent with chime_in_manual_quiet on', () => {
      expect(quiet.kind).toBe('scheduled')
      expect(shouldChime({ state: 'idle', prev: 'working' }, quiet, manualChime)).toBeNull()
      expect(shouldChime({ state: 'idle', prev: 'working' }, unlocked, manualChime)).toBeNull()
    })
  })
})
