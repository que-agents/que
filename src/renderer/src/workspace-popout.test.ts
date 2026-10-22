import { describe, expect, it } from 'vitest'
import { makePrCheck, makePullRequest } from '@renderer/testing/fixtures'
import type { Removal } from '../../shared/types'
import { firstFailingCheck, formatStepDuration, removalLines, tildePath } from './workspace-popout'

describe('tildePath', () => {
  it('writes ~ for the home directory and leaves other paths alone', () => {
    expect(tildePath('/Users/dev/w/uploader/app-1432-retry-logic', '/Users/dev')).toBe(
      '~/w/uploader/app-1432-retry-logic'
    )
    expect(tildePath('/Users/dev', '/Users/dev/')).toBe('~')
    expect(tildePath('/Users/devon/w/uploader', '/Users/dev')).toBe('/Users/devon/w/uploader')
    expect(tildePath('/Volumes/work/uploader', '/Users/dev')).toBe('/Volumes/work/uploader')
    expect(tildePath('/Users/dev/w/uploader', null)).toBe('/Users/dev/w/uploader')
  })
})

describe('firstFailingCheck', () => {
  it('names the first failing run while the checks fail, and nothing otherwise', () => {
    const runs = [
      makePrCheck({ name: 'lint', state: 'passing' }),
      makePrCheck({ name: 'e2e', state: 'failing' }),
      makePrCheck({ name: 'unit', state: 'failing' })
    ]

    expect(firstFailingCheck(makePullRequest({ checks: 'failing', checkRuns: runs }))).toBe('e2e')
    expect(firstFailingCheck(makePullRequest({ checks: 'passing', checkRuns: runs }))).toBeNull()
    expect(firstFailingCheck(makePullRequest({ checks: 'failing', checkRuns: [] }))).toBeNull()
  })
})

describe('removalLines', () => {
  const removal: Removal = {
    plan: ['terminals', 'teardown', 'worktree', 'branch'],
    step: 'worktree',
    since: '2026-10-17T16:00:00.000Z',
    done: [
      { step: 'terminals', ms: 100 },
      { step: 'teardown', ms: 60_000, error: 'timed out 60s' }
    ]
  }

  it('reads each planned step as done, failed, current or pending, in the plan’s order', () => {
    expect(removalLines(removal)).toEqual([
      { step: 'terminals', state: 'done', ms: 100 },
      { step: 'teardown', state: 'failed', ms: 60_000, error: 'timed out 60s' },
      { step: 'worktree', state: 'current' },
      { step: 'branch', state: 'pending' }
    ])
  })

  it('leaves out the steps the plan skips, and has no current step once every step has run', () => {
    expect(
      removalLines({
        plan: ['terminals', 'worktree'],
        step: null,
        since: removal.since,
        done: [
          { step: 'terminals', ms: 40 },
          { step: 'worktree', ms: 1_200 }
        ]
      }).map((l) => l.state)
    ).toEqual(['done', 'done'])
  })
})

describe('formatStepDuration', () => {
  it('writes tenths under ten seconds and whole seconds and minutes above', () => {
    expect(formatStepDuration(0)).toBe('0.0s')
    expect(formatStepDuration(100)).toBe('0.1s')
    expect(formatStepDuration(2_440)).toBe('2.4s')
    expect(formatStepDuration(9_940)).toBe('9.9s')
    expect(formatStepDuration(9_960)).toBe('10s')
    expect(formatStepDuration(12_000)).toBe('12s')
    expect(formatStepDuration(65_000)).toBe('1m 05s')
  })
})
