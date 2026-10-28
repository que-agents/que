import { describe, expect, it } from 'vitest'
import {
  buildHunks,
  FULL_CONTEXT_CHARS,
  FULL_CONTEXT_LINES,
  fitsFullContext,
  Lru,
  tokenizeHunkLines
} from './diff-file'
import { tokenizeFile } from './highlight'

const OLD = [
  'export function put(file) {',
  '  const retries = 1',
  '  return send(file)',
  '}',
  ''
].join('\n')

const NEW = [
  'export function put(file) {',
  '  const retries = 3',
  '  const backoffMs = 250',
  '  return send(file)',
  '}',
  ''
].join('\n')

const PATCH = [
  'diff --git a/put.ts b/put.ts',
  '--- a/put.ts',
  '+++ b/put.ts',
  '@@ -1,4 +1,5 @@',
  ' export function put(file) {',
  '-  const retries = 1',
  '+  const retries = 3',
  '+  const backoffMs = 250',
  '   return send(file)',
  ' }',
  ''
].join('\n')

describe('buildHunks', () => {
  const before = tokenizeFile(OLD, 'typescript').lines
  const after = tokenizeFile(NEW, 'typescript').lines
  const [hunk] = buildHunks(PATCH, before, after)

  it("gives every line its file's tokens, joined back to exactly the line", () => {
    expect(
      hunk?.lines.map((l) => [l.kind, l.old, l.new, l.tokens.map((t) => t.text).join('')])
    ).toEqual([
      ['context', 1, 1, 'export function put(file) {'],
      ['removed', 2, null, '  const retries = 1'],
      ['added', null, 2, '  const retries = 3'],
      ['added', null, 3, '  const backoffMs = 250'],
      ['context', 3, 4, '  return send(file)'],
      ['context', 4, 5, '}']
    ])
    expect(hunk?.lines[0]?.tokens.find((t) => t.text === 'put')?.kind).toBe('fn')
  })

  it('marks the changed word of a paired removed and added line', () => {
    const marks = hunk?.lines.map((l) => l.tokens.filter((t) => t.mark).map((t) => t.text))

    expect(marks).toEqual([[], ['1'], ['3'], [], [], []])
  })
})

describe('tokenizeHunkLines', () => {
  it('takes a context line from the old side when it only matches that one (git diff -w)', () => {
    const before = tokenizeFile('if (a) {\n', 'typescript').lines
    const after = tokenizeFile('if (a)  {\n', 'typescript').lines

    const [line] = tokenizeHunkLines(
      [{ kind: 'context', old: 1, new: 1, text: 'if (a) {' }],
      before,
      after
    )

    expect(line?.tokens.map((t) => t.text).join('')).toBe('if (a) {')
    expect(line?.tokens[0]).toEqual({ text: 'if', kind: 'ctrl' })
  })

  it('falls back to one plain token when neither side has the line', () => {
    const [line] = tokenizeHunkLines(
      [{ kind: 'added', old: null, new: 9, text: '  retry()' }],
      [],
      []
    )

    expect(line?.tokens).toEqual([{ text: '  retry()', kind: 'plain' }])
  })
})

describe('fitsFullContext', () => {
  it('fits when both sides are within the line and character caps', () => {
    const atCap = 'x\n'.repeat(FULL_CONTEXT_LINES)

    expect(fitsFullContext(OLD, NEW)).toBe(true)
    expect(fitsFullContext(atCap, '')).toBe(true)
    expect(fitsFullContext(`${atCap}x\n`, '')).toBe(false)
    expect(fitsFullContext('', 'y'.repeat(FULL_CONTEXT_CHARS + 1))).toBe(false)
  })
})

describe('Lru', () => {
  it('drops the least recently used entry past its limit', () => {
    const lru = new Lru<number>(2)
    lru.set('a', 1)
    lru.set('b', 2)
    lru.get('a')
    lru.set('c', 3)

    expect([lru.get('a'), lru.get('b'), lru.get('c')]).toEqual([1, undefined, 3])
  })

  it('bounds the summed weight of its entries and keeps none heavier than the bound', () => {
    const lru = new Lru<string>(10, (v) => v.length)
    lru.set('put.ts', 'xxxxxx')
    lru.set('retry.ts', 'yyyy')
    lru.set('backoff.ts', 'zzz')
    lru.set('huge.ts', 'w'.repeat(11))

    const kept = ['put.ts', 'retry.ts', 'backoff.ts', 'huge.ts'].map((k) => lru.get(k))

    expect(kept).toEqual([undefined, 'yyyy', 'zzz', undefined])
  })
})
