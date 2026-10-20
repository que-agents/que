import { describe, expect, it } from 'vitest'
import { sessionLabel } from './session-label'

describe('sessionLabel', () => {
  it.each([
    ['✳ Terminal title parsing', 'Terminal title parsing'],
    ['◐ Terminal title parsing', 'Terminal title parsing'],
    ['◑ Terminal title parsing', 'Terminal title parsing'],
    ['Terminal title parsing', 'Terminal title parsing'],
    ['  ✳   Terminal title parsing  ', 'Terminal title parsing'],
    ['✳ ◐ Spinner glyph names', '◐ Spinner glyph names']
  ])('reads %j as %j', (raw, label) => {
    expect(sessionLabel(raw)).toBe(label)
  })

  it.each([
    ['the placeholder with a glyph', '✳ Claude Code'],
    ['the placeholder without one', 'Claude Code'],
    ['a glyph alone', '◐ '],
    ['an empty title', ''],
    ['whitespace', '   '],
    ['no title', undefined]
  ])('has no label for %s', (_label, raw) => {
    expect(sessionLabel(raw)).toBeNull()
  })

  it('cuts a long title to 80 characters ending in an ellipsis', () => {
    const label = sessionLabel(`✳ ${'a'.repeat(100)}`)

    expect(label).toBe(`${'a'.repeat(79)}…`)
    expect(label).toHaveLength(80)
  })
})
