import { describe, expect, it } from 'vitest'
import { removalStep } from './removal'
import type { Removal } from './types'

const removal = (done: Removal['done']): Removal => ({
  plan: ['terminals', 'teardown', 'worktree'],
  since: '2026-10-26T09:00:00.000Z',
  done
})

describe('removalStep', () => {
  it('is the first planned step before any has run', () => {
    expect(removalStep(removal([]))).toBe('terminals')
  })

  it('is the step after the last one done, failed ones included', () => {
    expect(
      removalStep(
        removal([
          { step: 'terminals', ms: 80 },
          { step: 'teardown', ms: 1_200, error: 'exited with code 3' }
        ])
      )
    ).toBe('worktree')
  })

  it('is null once every step has run', () => {
    expect(
      removalStep(
        removal([
          { step: 'terminals', ms: 80 },
          { step: 'teardown', ms: 1_200 },
          { step: 'worktree', ms: 300 }
        ])
      )
    ).toBeNull()
  })
})
