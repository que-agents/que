import { describe, expect, it } from 'vitest'
import { defaultTitle, detectWake } from './queue'

describe('detectWake', () => {
  it('sees a sleep when the wall clock ran more than two minutes ahead of the monotonic one', () => {
    const wall = Date.parse('2026-10-14T02:00:00.000Z')

    expect(detectWake(wall, 1_000, wall + 5_000, 6_000)).toBe(false)
    expect(detectWake(wall, 1_000, wall + 126_000, 6_000)).toBe(true)
    expect(detectWake(wall, 1_000, wall + 124_000, 5_000)).toBe(false)
  })
})

describe('defaultTitle', () => {
  it("is the brief's first non-empty line", () => {
    expect(defaultTitle('\n  Add retry logic to the uploader  \nUse exponential backoff.')).toBe(
      'Add retry logic to the uploader'
    )
  })

  it('is cut to 80 characters', () => {
    const title = defaultTitle(`Refactor ${'the upload queue '.repeat(10)}`)

    expect(title).toHaveLength(80)
    expect(title.endsWith('…')).toBe(true)
  })
})
