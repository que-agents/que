import { describe, expect, it } from 'vitest'
import type { DiffLine } from '../shared/protocol'
import { markChangeBlocks, markTokens, wordRanges } from './word-marks'

const plain = (
  kind: DiffLine['kind'],
  text: string,
  old: number | null,
  next: number | null
): DiffLine => ({ kind, old, new: next, tokens: [{ text, kind: 'plain' }] })

const marked = (line: DiffLine | undefined): string[] =>
  (line?.tokens ?? []).filter((t) => t.mark).map((t) => t.text)

describe('wordRanges', () => {
  it('finds the words that changed on each side', () => {
    expect(wordRanges('const retries = 1', 'const retries = 3')).toEqual({
      removed: [{ start: 16, end: 17 }],
      added: [{ start: 16, end: 17 }]
    })
  })

  it('gives up on a pair that shares under 30% of its characters', () => {
    expect(wordRanges('return send(url, file)', 'throw new UploadError()')).toBeNull()
  })
})

describe('markTokens', () => {
  it('splits tokens at the range edges and keeps their kind and depth', () => {
    const tokens = [
      { text: 'retries', kind: 'var' as const },
      { text: '(', kind: 'punct' as const, depth: 0 },
      { text: '1)', kind: 'num' as const }
    ]

    expect(markTokens(tokens, [{ start: 4, end: 9 }])).toEqual([
      { text: 'retr', kind: 'var' },
      { text: 'ies', kind: 'var', mark: true },
      { text: '(', kind: 'punct', depth: 0, mark: true },
      { text: '1', kind: 'num', mark: true },
      { text: ')', kind: 'num' }
    ])
  })
})

describe('markChangeBlocks', () => {
  it('pairs the i-th removed line with the i-th added line of a block and leaves the rest unmarked', () => {
    const lines = [
      plain('context', 'async function put() {', 1, 1),
      plain('removed', '  const retries = 1', 2, null),
      plain('removed', '  const timeout = 30', 3, null),
      plain('added', '  const retries = 3', null, 2),
      plain('added', '  const timeout = 60', null, 3),
      plain('added', '  const backoffMs = 250', null, 4),
      plain('context', '}', 4, 5)
    ]

    const before = structuredClone(lines)

    const out = markChangeBlocks(lines)

    expect(out.map(marked)).toEqual([[], ['1'], ['30'], ['3'], ['60'], [], []])
    expect(out.map((l) => l.tokens.map((t) => t.text).join(''))).toEqual(
      lines.map((l) => l.tokens[0]?.text)
    )
    expect(lines).toEqual(before)
  })

  it('marks nothing on a lone added or removed line', () => {
    const out = markChangeBlocks([
      plain('added', 'export const backoffMs = 250', null, 1),
      plain('context', '', 1, 2),
      plain('removed', 'export const legacy = true', 2, null)
    ])

    expect(out.map(marked)).toEqual([[], [], []])
  })
})
