import { describe, expect, it } from 'vitest'
import { tabLabel } from './store'

describe('tabLabel', () => {
  it.each([
    [{ name: 'zsh', process: 'claude' }, 'claude'],
    [{ name: 'zsh' }, 'zsh'],
    [{ name: 'zsh', process: undefined }, 'zsh']
  ])('%o reads %s', (tab, label) => {
    expect(tabLabel(tab)).toBe(label)
  })
})
