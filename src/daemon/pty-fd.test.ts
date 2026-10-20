import { describe, expect, it } from 'vitest'
import { programOf } from './pty-fd'

describe('programOf', () => {
  it.each([
    ['the shell', 'zsh', 'zsh'],
    ['a program', 'cat', 'cat'],
    ['nothing before a group takes the terminal', 'kernel_task', undefined],
    ["nothing while node-pty's helper holds it before the shell", 'spawn-helper', undefined],
    ['nothing without a name', undefined, undefined],
    ['nothing for an empty name', '', undefined]
  ])('names %s', (_what, raw, expected) => {
    expect(programOf(raw)).toBe(expected)
  })
})
