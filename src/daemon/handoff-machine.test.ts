import { describe, expect, it } from 'vitest'
import {
  initialHandoff,
  stepHandoff,
  type HandoffInput,
  type HandoffState
} from './handoff-machine'

/** Runs the inputs from the start; the state and the effects of the last step. */
function run(...inputs: HandoffInput[]): ReturnType<typeof stepHandoff> {
  let step = { state: initialHandoff, effects: [] as ReturnType<typeof stepHandoff>['effects'] }

  for (const input of inputs) step = stepHandoff(step.state, input)

  return step
}

const ADOPTED: HandoffInput = { type: 'adopted' }
const RELEASED: HandoffInput = { type: 'released' }
const READY: HandoffInput = { type: 'ready', pid: 51877 }

describe('stepHandoff', () => {
  describe('transitions', () => {
    it('starts adopting', () => {
      expect(initialHandoff).toEqual({ phase: 'adopting' })
    })

    it('releases the socket once the successor has adopted the terminals', () => {
      expect(run(ADOPTED)).toEqual({ state: { phase: 'releasing' }, effects: ['release'] })
    })

    it('tells the successor to bind once the socket is released', () => {
      expect(run(ADOPTED, RELEASED)).toEqual({ state: { phase: 'binding' }, effects: ['bind'] })
    })

    it('answers with the successor pid once it serves', () => {
      expect(run(ADOPTED, RELEASED, READY)).toEqual({
        state: { phase: 'ready', pid: 51877 },
        effects: ['reply-ok']
      })
    })

    it('ignores a message out of order', () => {
      expect(run(READY)).toEqual({ state: { phase: 'adopting' }, effects: [] })
      expect(run(ADOPTED, READY)).toEqual({ state: { phase: 'releasing' }, effects: [] })
    })
  })

  describe('failures', () => {
    it('keeps serving and reads the terminals again when adopting fails', () => {
      expect(run({ type: 'failed', error: 'snapshot version 2 is not 1' })).toEqual({
        state: {
          phase: 'failed',
          error:
            'the new daemon failed while taking over the terminals: snapshot version 2 is not 1'
        },
        effects: ['kill-successor', 'resume', 'reply-error']
      })
    })

    it('treats a successor that exits before adopting as a failure', () => {
      expect(run({ type: 'exited', code: 1 }).state).toEqual({
        phase: 'failed',
        error: 'the new daemon exited (code 1) while taking over the terminals'
      })
    })

    it('listens again when the successor fails after the socket was released', () => {
      expect(run(ADOPTED, RELEASED, { type: 'failed', error: 'EADDRINUSE' })).toEqual({
        state: {
          phase: 'failed',
          error: 'the new daemon failed while binding the socket: EADDRINUSE'
        },
        effects: ['kill-successor', 'relisten', 'resume', 'reply-error']
      })
    })

    it('listens again when the successor dies while the socket is being released', () => {
      expect(run(ADOPTED, { type: 'exited', code: null }).effects).toEqual([
        'kill-successor',
        'relisten',
        'resume',
        'reply-error'
      ])
    })

    it('gives up on a successor that does not answer', () => {
      expect(run(ADOPTED, RELEASED, { type: 'timeout' })).toMatchObject({
        state: { phase: 'failed', error: 'the new daemon did not answer while binding the socket' },
        effects: ['kill-successor', 'relisten', 'resume', 'reply-error']
      })
    })

    it('changes nothing once ready, whatever the successor does next', () => {
      expect(run(ADOPTED, RELEASED, READY, { type: 'exited', code: 0 })).toEqual({
        state: { phase: 'ready', pid: 51877 },
        effects: []
      })
    })

    it('changes nothing once failed', () => {
      expect(run({ type: 'timeout' }, ADOPTED)).toEqual({
        state: {
          phase: 'failed',
          error: 'the new daemon did not answer while taking over the terminals'
        },
        effects: []
      })
    })
  })

  describe('purity', () => {
    it('returns a new state and leaves its input untouched', () => {
      const prev: HandoffState = { phase: 'binding' }
      const before = structuredClone(prev)

      const next = stepHandoff(prev, READY)

      expect(prev).toEqual(before)
      expect(next.state).not.toBe(prev)
    })
  })
})
