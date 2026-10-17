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

  it('writes an item with its own text verbatim, without its count', () => {
    expect(
      countLineText([
        { count: 1, label: 'done', tone: 'muted' },
        { count: 4_020_000, label: 'duration', text: '1h 07m' },
        { count: 1.2, label: 'cost', text: '$1.20' }
      ])
    ).toBe('1 done · 1h 07m · $1.20')
  })

  it('is empty without items', () => {
    expect(countLineText([])).toBe('')
  })
})
