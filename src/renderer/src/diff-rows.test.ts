import { describe, expect, it } from 'vitest'
import type { DiffHunk, DiffLine } from '../../preload/index.d'
import { makeWorkspaceDiffFile } from './testing/fixtures'
import {
  type DiffRow,
  type FoldRow,
  diffRows,
  revealLine,
  revealMore,
  splitRows
} from './diff-rows'

/** Lines from a picture: ' ' context, '-' removed, '+' added, numbered as git would. */
function linesOf(picture: string, oldStart = 1, newStart = 1): DiffLine[] {
  let o = oldStart
  let n = newStart

  return [...picture].map((c, i) => {
    const text = `  line ${i}`

    if (c === '-')
      return { kind: 'removed', old: o++, new: null, tokens: [{ text, kind: 'plain' }] }

    if (c === '+') return { kind: 'added', old: null, new: n++, tokens: [{ text, kind: 'plain' }] }

    return { kind: 'context', old: o++, new: n++, tokens: [{ text, kind: 'plain' }] }
  })
}

function hunk(lines: DiffLine[], over: Partial<DiffHunk> = {}): DiffHunk {
  return { oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, label: '', lines, ...over }
}

const kinds = (rows: DiffRow[]): string[] =>
  rows.map((r) => (r.kind === 'line' ? `${r.line.kind[0]}${r.index}` : `${r.kind}`))

const folds = (rows: DiffRow[]): FoldRow[] => rows.filter((r): r is FoldRow => r.kind === 'fold')

const ctx = (n: number): string => ' '.repeat(n)

describe('diffRows', () => {
  describe('whole-file context', () => {
    it('folds a long unchanged run between changes, leaving three lines each side', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(`-${ctx(30)}+`))] })

      const rows = diffRows(file)

      expect(kinds(rows)).toEqual(['r0', 'c1', 'c2', 'c3', 'fold', 'c28', 'c29', 'c30', 'a31'])
      expect(folds(rows)[0]).toMatchObject({ id: '1:31', hidden: 24, down: 20, up: 20 })
    })

    it('leaves a run of eight lines alone and folds one of nine', () => {
      const eight = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(`-${ctx(8)}+`))] })
      const nine = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(`-${ctx(9)}+`))] })

      expect(folds(diffRows(eight))).toEqual([])
      expect(folds(diffRows(nine))[0]).toMatchObject({ hidden: 3, down: 3, up: 3 })
    })

    it('keeps context only on the side that touches a change at the start and end of the file', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(`${ctx(12)}-+${ctx(12)}`))] })

      const rows = diffRows(file)

      expect(kinds(rows)).toEqual([
        'fold',
        'c9',
        'c10',
        'c11',
        'r12',
        'a13',
        'c14',
        'c15',
        'c16',
        'fold'
      ])
      expect(folds(rows)).toEqual([
        expect.objectContaining({ id: '0:12', hidden: 9, down: 0, up: 9 }),
        expect.objectContaining({ id: '14:26', hidden: 9, down: 9, up: 0 })
      ])
    })

    it('names the nearest function line above the hidden end, as git would', () => {
      const lines = linesOf(`-${ctx(30)}+`)
      lines[5].tokens = [{ text: 'function capPatch(patch: string) {', kind: 'plain' }]
      lines[6].tokens = [{ text: '  const max = 40', kind: 'plain' }]
      const file = makeWorkspaceDiffFile({ hunks: [hunk(lines)] })

      expect(folds(diffRows(file))[0].label).toBe('function capPatch(patch: string) {')
    })

    it('reveals twenty lines from either edge, then the rest, without changing the fold id', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(`-${ctx(60)}+`))] })
      const fold = folds(diffRows(file))[0]

      const down = revealMore({}, fold, 'down')
      const afterDown = folds(diffRows(file, down))[0]
      expect(afterDown).toMatchObject({ id: fold.id, hidden: 34 })
      expect(diffRows(file, down)[4]).toMatchObject({ kind: 'line', index: 4 })

      const up = revealMore(down, afterDown, 'up')
      expect(folds(diffRows(file, up))[0]).toMatchObject({ hidden: 14, down: 14, up: 14 })

      const all = revealMore(up, folds(diffRows(file, up))[0], 'all')
      expect(folds(diffRows(file, all))).toEqual([])
      expect(diffRows(file, all)).toHaveLength(62)
    })

    it('renders only the rows left after folding a long file', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(`${ctx(2500)}-+${ctx(2500)}`))] })

      expect(diffRows(file)).toHaveLength(10)
    })
  })

  describe('hunks only', () => {
    it('counts the unchanged lines before and between hunks with the next hunk label', () => {
      const file = makeWorkspaceDiffFile({
        fullContext: false,
        hunks: [
          hunk(linesOf(' - ', 10, 10), { oldStart: 10, oldLines: 3, newStart: 10, newLines: 2 }),
          hunk(linesOf(' + ', 40, 39), {
            oldStart: 40,
            oldLines: 2,
            newStart: 39,
            newLines: 3,
            label: 'export async function put(file: Blob) {'
          })
        ]
      })

      const rows = diffRows(file)

      expect(kinds(rows)).toEqual(['gap', 'c0', 'r1', 'c2', 'gap', 'c3', 'a4', 'c5'])
      expect(rows[0]).toMatchObject({ kind: 'gap', count: 9, label: '' })
      expect(rows[4]).toMatchObject({
        kind: 'gap',
        count: 27,
        label: 'export async function put(file: Blob) {'
      })
    })

    it('never folds inside a hunk', () => {
      const file = makeWorkspaceDiffFile({
        fullContext: false,
        hunks: [hunk(linesOf(`-${ctx(20)}+`), { newLines: 21 })]
      })

      expect(folds(diffRows(file))).toEqual([])
    })
  })
})

describe('splitRows', () => {
  it('pairs the i-th removed line with the i-th added one and leaves the rest alone', () => {
    const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(' ---++ +'))] })

    const pairs = splitRows(diffRows(file)).map((r) =>
      r.kind === 'pair' ? [r.left?.kind ?? null, r.right?.kind ?? null] : r.kind
    )

    expect(pairs).toEqual([
      ['context', 'context'],
      ['removed', 'added'],
      ['removed', 'added'],
      ['removed', null],
      ['context', 'context'],
      [null, 'added']
    ])
  })

  it('keeps folds as rows of their own', () => {
    const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(`-${ctx(30)}+`))] })

    expect(splitRows(diffRows(file)).map((r) => r.kind)).toEqual([
      'pair',
      'pair',
      'pair',
      'pair',
      'fold',
      'pair',
      'pair',
      'pair',
      'pair'
    ])
  })
})

describe('revealLine', () => {
  it('opens the fold that hides a line of the new file', () => {
    const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(`-${ctx(30)}+`))] })

    const reveals = revealLine(file, {}, 15)

    expect(folds(diffRows(file, reveals))).toEqual([])
  })

  it('returns the same reveals when the line is already shown', () => {
    const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(`-${ctx(30)}+`))] })
    const reveals = {}

    expect(revealLine(file, reveals, 2)).toBe(reveals)
  })
})
