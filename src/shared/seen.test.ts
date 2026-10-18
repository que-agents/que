import { describe, expect, it } from 'vitest'
import { makeWorkspace } from '../testing/entities'
import { unseenDone } from './seen'

describe('unseenDone', () => {
  it('is false for a workspace that never finished, seen or not', () => {
    expect(unseenDone(makeWorkspace({ finishedAt: null, seenAt: null }))).toBe(false)
    expect(
      unseenDone(makeWorkspace({ finishedAt: null, seenAt: '2026-10-17T21:10:00.000Z' }))
    ).toBe(false)
  })

  it('is true for a workspace that finished and was never seen', () => {
    expect(
      unseenDone(makeWorkspace({ finishedAt: '2026-10-17T21:12:00.000Z', seenAt: null }))
    ).toBe(true)
  })

  it('is false once seen after it finished', () => {
    expect(
      unseenDone(
        makeWorkspace({
          finishedAt: '2026-10-17T21:12:00.000Z',
          seenAt: '2026-10-17T21:15:30.000Z'
        })
      )
    ).toBe(false)
  })

  it('is true again when it finishes again after it was seen', () => {
    expect(
      unseenDone(
        makeWorkspace({
          finishedAt: '2026-10-17T21:40:00.000Z',
          seenAt: '2026-10-17T21:15:30.000Z'
        })
      )
    ).toBe(true)
  })

  it('is false when it was seen at the moment it finished (selected while it finished)', () => {
    expect(
      unseenDone(
        makeWorkspace({
          finishedAt: '2026-10-17T21:40:00.000Z',
          seenAt: '2026-10-17T21:40:00.000Z'
        })
      )
    ).toBe(false)
  })
})
