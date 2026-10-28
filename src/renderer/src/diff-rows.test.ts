import { describe, expect, it } from 'vitest'
import type { DiffHunk, DiffLine } from '../../preload/index.d'
import { makeWorkspaceDiffFile } from './testing/fixtures'
import {
  type CommentRunRow,
  type CommentView,
  type DiffRow,
  type FoldRow,
  diffRows,
  revealComments,
  revealLine,
  revealMore,
  splitCounts,
  splitRows,
  toggleCommentRun
} from './diff-rows'

/**
 * Lines from a picture: ' ' context, '-' removed, '+' added, '<' a removed comment line, '>' an
 * added one, numbered as the diff would.
 */
function linesOf(picture: string, oldStart = 1, newStart = 1): DiffLine[] {
  let o = oldStart
  let n = newStart

  return [...picture].map((c, i) => {
    const text = `  line ${i}`
    const note = [{ text: `  // note ${i}`, kind: 'comment' as const }]

    if (c === '<') return { kind: 'removed', old: o++, new: null, tokens: note, comment: true }

    if (c === '>') return { kind: 'added', old: null, new: n++, tokens: note, comment: true }

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
  rows.map((r) =>
    r.kind === 'line'
      ? `${r.line.kind[0]}${r.index}`
      : r.kind === 'comments'
        ? `${r.id}${r.open ? ' open' : ''}`
        : r.kind
  )

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

/** The Fold comment mode, removed comments kept or not, with these lines of the new file targeted. */
const fold = (keepRemoved: boolean, targets: number[] = []): CommentView => ({
  mode: 'fold',
  keepRemoved,
  targets: new Set(targets)
})

const commentRows = (rows: DiffRow[]): CommentRunRow[] =>
  rows.filter((r): r is CommentRunRow => r.kind === 'comments')

describe('comment lines', () => {
  describe('dim and show', () => {
    it('draws every line, the same rows as without comment lines', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(' <>> + '))] })

      for (const mode of ['dim', 'show'] as const) {
        const rows = diffRows(file, {}, { mode, keepRemoved: true, targets: new Set() })

        expect(kinds(rows)).toEqual(['c0', 'r1', 'a2', 'a3', 'c4', 'a5', 'c6'])
      }
    })
  })

  describe('fold', () => {
    it('folds a run of added comment lines to one row with its line range', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf('  >>>+  '))] })

      const rows = diffRows(file, {}, fold(true))

      expect(kinds(rows)).toEqual(['c0', 'c1', 'c:2:5', 'a5', 'c6', 'c7'])
      expect(commentRows(rows)[0]).toMatchObject({
        open: false,
        pinned: false,
        added: 3,
        removed: 0,
        first: 3,
        last: 5
      })
    })

    it('folds a removed run when removed comments are not kept, numbered in the old file', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(' +<< '))] })

      const rows = diffRows(file, {}, fold(false))

      expect(kinds(rows)).toEqual(['c0', 'a1', 'c:2:4', 'c4'])
      expect(commentRows(rows)[0]).toMatchObject({ added: 0, removed: 2, first: 2, last: 3 })
    })

    it('counts a mixed run both ways and numbers it by the lines it adds', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(' -<>> '))] })

      const [run] = commentRows(diffRows(file, {}, fold(false)))

      expect(run).toMatchObject({ id: 'c:2:5', added: 2, removed: 1, first: 2, last: 3 })
    })

    it('keeps removed comment lines drawn when they are kept, folding only the added ones', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(' -<>> '))] })

      const rows = diffRows(file, {}, fold(true))

      expect(kinds(rows)).toEqual(['c0', 'r1', 'r2', 'c:3:5', 'c5'])
    })

    it('opens a run in place and folds it again', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(' +>> '))] })
      const [run] = commentRows(diffRows(file, {}, fold(true)))

      const opened = toggleCommentRun({}, run)

      expect(kinds(diffRows(file, opened, fold(true)))).toEqual([
        'c0',
        'a1',
        'c:2:4 open',
        'a2',
        'a3',
        'c4'
      ])
      expect(toggleCommentRun(opened, { ...run, open: true })).toEqual({})
    })

    it('keeps a run open, pinned, while a review comment points at one of its lines', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(' +>> '))] })

      const rows = diffRows(file, {}, fold(true, [4]))

      expect(kinds(rows)).toEqual(['c0', 'a1', 'c:2:4 open', 'a2', 'a3', 'c4'])
      expect(commentRows(rows)[0].pinned).toBe(true)
    })

    it('folds runs inside a hunk when the diff carries only its hunks', () => {
      const file = makeWorkspaceDiffFile({
        fullContext: false,
        hunks: [hunk(linesOf(' >>+ ', 10, 10), { oldStart: 10, newStart: 10, newLines: 5 })]
      })

      expect(kinds(diffRows(file, {}, fold(true)))).toEqual(['gap', 'c0', 'c:1:3', 'a3', 'c4'])
    })
  })

  describe('a change of comment lines alone', () => {
    // A code change, 12 unchanged, a comment rewritten (1 removed, 4 added), 12 unchanged, a code change.
    const picture = `+${ctx(12)}<>>>>${ctx(12)}+`

    it('folds into the unchanged lines around it, which count it apart', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(picture))] })

      const rows = diffRows(file, {}, fold(false))

      expect(kinds(rows)).toEqual(['a0', 'c1', 'c2', 'c3', 'fold', 'c27', 'c28', 'c29', 'a30'])
      expect(folds(rows)[0]).toMatchObject({
        id: '1:30',
        hidden: 23,
        comments: { added: 4, removed: 1, ids: ['c:13:18'] }
      })
    })

    it('shows the change, its run open, once the fold reveals it', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(picture))] })
      const merged = folds(diffRows(file, {}, fold(false)))[0]

      const rows = diffRows(file, revealComments({}, merged), fold(false))

      expect(folds(rows)).toHaveLength(2)
      expect(kinds(rows)).toContain('c:13:18 open')
      expect(folds(rows).every((f) => f.comments === undefined)).toBe(true)
    })

    it('stays a change of its own when the unchanged lines around it are too few to fold', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf('+  >>  +'))] })

      expect(kinds(diffRows(file, {}, fold(false)))).toEqual([
        'a0',
        'c1',
        'c2',
        'c:3:5',
        'c5',
        'c6',
        'a7'
      ])
    })

    it('stays a change of its own when it removes a comment that is kept', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(picture))] })

      const rows = diffRows(file, {}, fold(true))

      expect(folds(rows).every((f) => f.comments === undefined)).toBe(true)
      expect(kinds(rows)).toEqual(expect.arrayContaining(['r13', 'c:14:18']))
    })

    it('stays open as a change of its own when a review comment points into it', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(picture))] })

      const rows = diffRows(file, {}, fold(false, [15]))

      expect(folds(rows).every((f) => f.comments === undefined)).toBe(true)
      expect(commentRows(rows)).toEqual([expect.objectContaining({ open: true, pinned: true })])
    })

    it('needs no reveal for a line a link asks for inside it', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(picture))] })
      const reveals = {}

      expect(revealLine(file, reveals, 15, fold(false, [15]))).toBe(reveals)
    })

    it('reveals the whole fold, the change with it, from its count', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(picture))] })
      const merged = folds(diffRows(file, {}, fold(false)))[0]

      const rows = diffRows(file, revealMore({}, merged, 'all'), fold(false))

      expect(folds(rows)).toEqual([])
      expect(rows).toHaveLength(31)
    })
  })

  describe('split', () => {
    it('keeps a folded run as one row across both sides', () => {
      const file = makeWorkspaceDiffFile({ hunks: [hunk(linesOf(' ->>+ '))] })

      const split = splitRows(diffRows(file, {}, fold(true)))

      expect(split.map((r) => r.kind)).toEqual(['pair', 'pair', 'comments', 'pair', 'pair'])
    })
  })

  describe('splitCounts', () => {
    it('counts code and comment lines apart', () => {
      expect(splitCounts(linesOf(' -<>>+ '))).toEqual({
        codeAdditions: 1,
        codeDeletions: 1,
        commentAdditions: 2,
        commentDeletions: 1
      })
    })
  })
})
