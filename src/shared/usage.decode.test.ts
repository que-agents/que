import { describe, expect, it } from 'vitest'
import { decodeStatusLineUsage, decodeUsage, parseStatusLine } from './usage.decode'

// A status line payload as Claude Code sends it on a plan account.
const payload = {
  session_id: '7d0c5b2a-0000-4000-8000-3e4f5a6b7c8d',
  cwd: '/Users/dev/.que/worktrees/uploader/app-1432-retry-logic/src',
  workspace: {
    current_dir: '/Users/dev/.que/worktrees/uploader/app-1432-retry-logic/src',
    project_dir: '/Users/dev/.que/worktrees/uploader/app-1432-retry-logic'
  },
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
    seven_day: { used_percentage: 41.2, resets_at: 1738857600 }
  }
}

describe('decodeStatusLineUsage', () => {
  it('reads both windows, resets_at from seconds to milliseconds', () => {
    expect(decodeStatusLineUsage(payload)).toEqual({
      fiveHour: { pct: 23.5, resetsAt: 1738425600_000 },
      sevenDay: { pct: 41.2, resetsAt: 1738857600_000 }
    })
  })

  it('reads one window when Claude Code sends only one', () => {
    expect(
      decodeStatusLineUsage({
        rate_limits: { seven_day: { used_percentage: 7, resets_at: 1738857600 } }
      })
    ).toEqual({ sevenDay: { pct: 7, resetsAt: 1738857600_000 } })
  })

  it('reads no window before the first reply or on an account without plan limits', () => {
    expect(decodeStatusLineUsage({ session_id: payload.session_id, cwd: payload.cwd })).toEqual({})
  })

  describe('errors', () => {
    it('ignores a malformed window and keeps the other', () => {
      expect(
        decodeStatusLineUsage({
          rate_limits: {
            five_hour: { used_percentage: '23.5', resets_at: 1738425600 },
            seven_day: { used_percentage: 41.2, resets_at: 1738857600 }
          }
        })
      ).toEqual({ sevenDay: { pct: 41.2, resetsAt: 1738857600_000 } })
      expect(
        decodeStatusLineUsage({
          rate_limits: {
            five_hour: { used_percentage: 23.5 },
            seven_day: { used_percentage: Number.NaN, resets_at: 1738857600 }
          }
        })
      ).toEqual({})
    })

    it('clamps a percentage outside 0–100', () => {
      expect(
        decodeStatusLineUsage({
          rate_limits: { five_hour: { used_percentage: 104.2, resets_at: 1738425600 } }
        })
      ).toEqual({ fiveHour: { pct: 100, resetsAt: 1738425600_000 } })
    })

    it('reads nothing from input that is not an object', () => {
      expect(decodeStatusLineUsage(null)).toEqual({})
      expect(decodeStatusLineUsage('rate_limits')).toEqual({})
      expect(decodeStatusLineUsage({ rate_limits: [1, 2] })).toEqual({})
    })
  })
})

describe('parseStatusLine', () => {
  it('reads the windows and the project directory', () => {
    expect(parseStatusLine(JSON.stringify(payload))).toEqual({
      windows: decodeStatusLineUsage(payload),
      projectDir: '/Users/dev/.que/worktrees/uploader/app-1432-retry-logic'
    })
  })

  it('takes cwd when the payload names no project directory', () => {
    expect(parseStatusLine(JSON.stringify({ cwd: payload.cwd })).projectDir).toBe(payload.cwd)
    expect(parseStatusLine('{}').projectDir).toBeUndefined()
  })

  it('reads nothing from text that is not JSON', () => {
    expect(parseStatusLine('not json')).toEqual({ windows: {}, projectDir: undefined })
  })
})

describe('decodeUsage', () => {
  it('keeps a reading with its windows and workspace', () => {
    const usage = {
      fiveHour: { pct: 42, resetsAt: 1792000000000 },
      sevenDay: { pct: 18, resetsAt: 1792400000000 },
      at: 1791990000000,
      workspaceId: 'ws_01hzx3k9c2qf'
    }

    expect(decodeUsage(usage)).toEqual(usage)
  })

  it('drops malformed windows and needs a time', () => {
    expect(decodeUsage({ fiveHour: { pct: 42 }, at: 1791990000000 })).toEqual({
      at: 1791990000000
    })
    expect(decodeUsage({ fiveHour: { pct: 42, resetsAt: 1792000000000 } })).toBeNull()
    expect(decodeUsage({ sevenDay: { pct: 42, resetsAt: -1 }, at: 1791990000000 })).toEqual({
      at: 1791990000000
    })
  })
})
