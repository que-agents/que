import { describe, expect, it } from 'vitest'
import { countLineText } from './count-line'

describe('countLineText', () => {
  it('writes each count with its label, separated by middle dots', () => {
    expect(
      countLineText([
        { count: 2, label: 'running', tone: 'muted' },
        { count: 1, label: 'waiting' },
        { count: 3, label: 'done' }
      ])
    ).toBe('2 running · 1 waiting · 3 done')
  })

  it('puts a note in brackets after its label', () => {
    expect(
      countLineText([
        { count: 1, label: 'paused', note: 'limit resets 03:00' },
        { count: 1, label: 'idle' }
      ])
    ).toBe('1 paused (limit resets 03:00) · 1 idle')
  })

  it('is empty without items', () => {
    expect(countLineText([])).toBe('')
  })
})
