// What a diff tab draws, row by row, from workspace.diffFile's hunks: the lines, the folded runs
// of unchanged lines (whole-file context) or the gaps between hunks, and the same rows paired
// side by side for the split view. Under the Fold comment mode, each run of comment lines in a
// change is one row too, and a change of comment lines alone joins the unchanged fold around it.
// Pure: the tab keeps the reveals and renders the rows.
import type { DiffLine, WorkspaceDiffFile } from '../../preload/index.d'
import { lineText } from '../../shared/protocol'

/** A run of unchanged lines longer than this folds. */
export const FOLD_MIN = 8

/** Lines of context a fold leaves on each side that touches a change. */
export const FOLD_CONTEXT = 3

/** Lines one ↑ or ↓ reveals. */
export const REVEAL_STEP = 20

/**
 * How much of a fold has been revealed: `down` lines from its top edge (below the change above
 * it), `up` from its bottom edge (above the change below it). Infinity on both: all of it.
 */
export interface Reveal {
  down: number
  up: number
}

/**
 * Per fold id, what has been revealed of it. A fold id outlives nothing but its own run. A run
 * of comment lines (`c:start:end`) is open while it has an entry.
 */
export interface Reveals {
  readonly [foldId: string]: Reveal
}

export const NO_REVEALS: Reveals = {}

export const REVEAL_ALL: Reveal = { down: Infinity, up: Infinity }

/** How a diff tab draws changed comment lines: dimmed (the default), as code, or folded away. */
export const COMMENT_MODES = ['dim', 'show', 'fold'] as const

export type CommentMode = (typeof COMMENT_MODES)[number]

/** How a project's diff tabs treat changed comment lines; remembered per project. */
export interface DiffComments {
  mode: CommentMode
  /** Under Fold: removed comment lines stay drawn rather than folding. */
  keepRemoved: boolean
}

/** What the rows need to know about comment lines. */
export interface CommentView extends DiffComments {
  /** Lines of the new file a review comment points at (or a link asked for): their runs stay open. */
  targets: ReadonlySet<number>
}

export interface LineRow {
  kind: 'line'
  /** The line's index in the file's lines, all hunks in order: a stable key. */
  index: number
  line: DiffLine
}

/** Unchanged lines folded away, whole-file context only. */
export interface FoldRow {
  kind: 'fold'
  /** The whole run's `start:end` in the file's lines: the same while the file keeps its shape. */
  id: string
  /** Every line the fold hides, the comment-only changes it took in included. */
  hidden: number
  /** Lines ↓ reveals from the top edge, 0 when the run starts the file (no ↓). */
  down: number
  /** Lines ↑ reveals from the bottom edge, 0 when the run ends the file (no ↑). */
  up: number
  /** The line the diff would name as the enclosing function, '' when none. */
  label: string
  /**
   * Under Fold, the comment-only changes the fold took in: their hidden added and removed lines,
   * and the ids of their runs (opening those shows them). Absent when it took in none.
   */
  comments?: { added: number; removed: number; ids: string[] }
}

/** Unchanged lines between hunks the diff does not carry: a count, never expandable. */
export interface GapRow {
  kind: 'gap'
  id: string
  count: number
  label: string
}

/**
 * Under Fold, a run of consecutive comment lines inside a change: one slim row, then its lines
 * while open. `pinned`: open because a review comment points at one of its lines.
 */
export interface CommentRunRow {
  kind: 'comments'
  /** `c:start:end` in the file's lines. */
  id: string
  open: boolean
  pinned: boolean
  added: number
  removed: number
  /** The run's first and last line numbers: the new file's when it adds lines, else the old's. */
  first: number
  last: number
}

export type DiffRow = LineRow | FoldRow | GapRow | CommentRunRow

/** A split row: the old line at the left, the new at the right; a context line on both. */
export interface PairRow {
  kind: 'pair'
  /** The index of its first line: a stable key. */
  index: number
  left: DiffLine | null
  right: DiffLine | null
}

export type SplitRow = PairRow | FoldRow | GapRow | CommentRunRow

/** Every line of the file, all hunks in order. */
export function fileLines(file: WorkspaceDiffFile): DiffLine[] {
  return file.hunks.flatMap((h) => h.lines)
}

/** A changed line that is a comment line. */
export const isCommentLine = (l: DiffLine): boolean => l.kind !== 'context' && l.comment === true

/** The code and comment lines a file adds and removes. */
export interface LineSplit {
  codeAdditions: number
  codeDeletions: number
  commentAdditions: number
  commentDeletions: number
}

/** Counts a file's changed lines, code apart from comments. */
export function splitCounts(lines: readonly DiffLine[]): LineSplit {
  const split = { codeAdditions: 0, codeDeletions: 0, commentAdditions: 0, commentDeletions: 0 }

  for (const l of lines) {
    if (l.kind === 'context') continue
    const added = l.kind === 'added'

    if (l.comment) split[added ? 'commentAdditions' : 'commentDeletions']++
    else split[added ? 'codeAdditions' : 'codeDeletions']++
  }

  return split
}

interface Run {
  start: number
  end: number
}

const runId = (r: Run): string => `${r.start}:${r.end}`
const commentId = (r: Run): string => `c:${r.start}:${r.end}`

/** The maximal runs of lines `pick` takes. */
function runsOf(count: number, pick: (i: number) => boolean): Run[] {
  const runs: Run[] = []
  let start = -1

  for (let i = 0; i <= count; i++) {
    const taken = i < count && pick(i)

    if (taken && start < 0) start = i

    if (!taken && start >= 0) {
      runs.push({ start, end: i })
      start = -1
    }
  }

  return runs
}

/** The maximal runs `context` takes that are longer than FOLD_MIN. */
function longRuns(count: number, context: (i: number) => boolean): Run[] {
  return runsOf(count, context).filter((r) => r.end - r.start > FOLD_MIN)
}

/** The diff's default function line: one that starts with a letter, `_` or `$`. */
const FUNCNAME = /^[A-Za-z_$]/

/** Per line, the nearest function line at or above it in the new file ('' when none). */
function functionLabels(lines: readonly DiffLine[]): string[] {
  let label = ''

  return lines.map((line) => {
    if (line.kind !== 'removed') {
      const text = lineText(line.tokens)

      if (FUNCNAME.test(text)) label = text.trimEnd()
    }

    return label
  })
}

/** What stays hidden of a run, [from, to) in the file's lines, and whether a change sits above and below it. */
interface Hidden {
  from: number
  to: number
  above: boolean
  below: boolean
}

/** What stays hidden of a run after its context and reveals. */
function hiddenRange(run: Run, total: number, reveal: Reveal | undefined): Hidden {
  const above = run.start > 0
  const below = run.end < total
  const from = run.start + (above ? FOLD_CONTEXT : 0) + (reveal?.down ?? 0)
  const to = run.end - (below ? FOLD_CONTEXT : 0) - (reveal?.up ?? 0)

  return { from, to, above, below }
}

/** The bottom edge of the new file's lines before a hunk, so the gap before it can be counted. */
function linesBefore(h: WorkspaceDiffFile['hunks'][number]): number {
  return h.newLines > 0 ? h.newStart - 1 : h.newStart
}

/** Whether a review comment (or a link) points at a line of the run. */
function pinnedRun(lines: readonly DiffLine[], r: Run, view: CommentView): boolean {
  return lines.slice(r.start, r.end).some((l) => l.new !== null && view.targets.has(l.new))
}

/**
 * A test for whether a line falls in one of `runs` (sorted, apart), for lines asked about in
 * order: it walks the runs once.
 */
function inRuns(runs: readonly Run[]): (i: number) => boolean {
  let k = 0

  return (i) => {
    while (k < runs.length && runs[k].end <= i) k++

    return k < runs.length && runs[k].start <= i
  }
}

/** A run of comment lines that folds to one row, and whether it is open (and why). */
interface CommentRun {
  run: Run
  open: boolean
  pinned: boolean
}

/** How a file's lines fold: the unchanged runs, and under Fold the comment runs. */
interface Plan {
  lines: DiffLine[]
  /** The unchanged runs that fold, comment-only changes they took in counted as unchanged. */
  folds: Run[]
  /** The comment-only changes the folds took in. */
  absorbed: Run[]
  /** The runs of comment lines that fold to one row, by their first line. */
  comments: Map<number, CommentRun>
}

/**
 * Under Fold: the changes made of comment lines alone that sit wholly inside an unchanged fold
 * (with its context lines, before any reveal) are taken into it; each other run of comment lines
 * (removed ones left out when they are kept) folds to a row of its own.
 */
function plan(file: WorkspaceDiffFile, reveals: Reveals, view: CommentView): Plan {
  const lines = fileLines(file)
  const n = lines.length
  const folding = view.mode === 'fold'

  const foldable = (l: DiffLine): boolean =>
    folding && isCommentLine(l) && !(view.keepRemoved && l.kind === 'removed')

  const look = (run: Run): CommentRun => {
    const pinned = pinnedRun(lines, run, view)

    return { run, pinned, open: pinned || commentId(run) in reveals }
  }

  let absorbed =
    folding && file.fullContext
      ? runsOf(n, (i) => lines[i].kind !== 'context').filter(
          (r) => lines.slice(r.start, r.end).every(foldable) && !look(r).open
        )
      : []

  let folds: Run[] = []

  // Taking a change in can only make a fold longer, so drop the ones no fold holds until none is left.
  for (;;) {
    const taken = inRuns(absorbed)
    folds = file.fullContext ? longRuns(n, (i) => lines[i].kind === 'context' || taken(i)) : []

    const inside = absorbed.filter((b) =>
      folds.some((f) => {
        const { from, to } = hiddenRange(f, n, undefined)

        return b.start >= from && b.end <= to
      })
    )

    if (inside.length === absorbed.length) break
    absorbed = inside
  }

  const taken = inRuns(absorbed)
  const runs = runsOf(n, (i) => !taken(i) && foldable(lines[i]))

  return { lines, folds, absorbed, comments: new Map(runs.map((r) => [r.start, look(r)])) }
}

/** The slim row of a run of comment lines. */
function commentRow(
  lines: readonly DiffLine[],
  r: Run,
  open: boolean,
  pinned: boolean
): CommentRunRow {
  const run = lines.slice(r.start, r.end)
  const added = run.filter((l) => l.kind === 'added')

  const numbers = (added.length > 0 ? added.map((l) => l.new) : run.map((l) => l.old)).filter(
    (x): x is number => x !== null
  )

  return {
    kind: 'comments',
    id: commentId(r),
    open,
    pinned,
    added: added.length,
    removed: run.length - added.length,
    first: numbers[0] ?? 0,
    last: numbers.at(-1) ?? 0
  }
}

/**
 * The rows of the unified view. With whole-file context, each run of unchanged lines longer
 * than FOLD_MIN folds, leaving FOLD_CONTEXT lines on each side that touches a change, less
 * whatever `reveals` uncovered; without it, each gap before or between hunks is a count. Under
 * the Fold comment mode, runs of comment lines fold too (see `plan`).
 */
export function diffRows(file: WorkspaceDiffFile, reveals: Reveals, view: CommentView): DiffRow[] {
  const p = plan(file, reveals, view)
  const { lines } = p
  const rows: DiffRow[] = []
  let next = 0

  const line = (i: number): void => {
    rows.push({ kind: 'line', index: i, line: lines[i] })
  }

  // Lines up to `to`, each comment run (whole, since unchanged folds never cut one) as its row.
  const push = (to: number): void => {
    while (next < to) {
      const found = p.comments.get(next)

      if (!found) {
        line(next++)
        continue
      }

      const { run, open, pinned } = found
      rows.push(commentRow(lines, run, open, pinned))

      if (open) for (let i = run.start; i < run.end; i++) line(i)
      next = run.end
    }
  }

  if (!file.fullContext) return gappedRows(file, rows, push)
  const labels = functionLabels(lines)

  for (const run of p.folds) {
    const id = runId(run)
    const { from, to, above, below } = hiddenRange(run, lines.length, reveals[id])

    if (to - from <= 0) continue
    push(from)
    const hidden = to - from

    const fold: FoldRow = {
      kind: 'fold',
      id,
      hidden,
      down: above ? Math.min(REVEAL_STEP, hidden) : 0,
      up: below ? Math.min(REVEAL_STEP, hidden) : 0,
      label: labels[to - 1]
    }

    const within = p.absorbed.filter((b) => b.start < to && b.end > from)

    if (within.length > 0) {
      const hid = lines.slice(from, to).filter(isCommentLine)
      const added = hid.filter((l) => l.kind === 'added').length
      fold.comments = { added, removed: hid.length - added, ids: within.map(commentId) }
    }

    rows.push(fold)
    next = to
  }

  push(lines.length)

  return rows
}

function gappedRows(
  file: WorkspaceDiffFile,
  rows: DiffRow[],
  push: (to: number) => void
): DiffRow[] {
  let index = 0
  let end = 0

  file.hunks.forEach((h, i) => {
    const count = linesBefore(h) - end

    if (count > 0) rows.push({ kind: 'gap', id: `gap:${i}`, count, label: h.label })
    index += h.lines.length
    push(index)
    end = linesBefore(h) + h.newLines
  })

  return rows
}

/**
 * The unified rows side by side: a context line on both sides; within a change, the i-th
 * removed line beside the i-th added one, and nothing beside the rest. Folds, gaps and comment
 * runs' rows stay, across both sides.
 */
export function splitRows(rows: readonly DiffRow[]): SplitRow[] {
  const out: SplitRow[] = []
  let removed: LineRow[] = []
  let added: LineRow[] = []

  const flush = (): void => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      const l = removed[i]
      const r = added[i]
      out.push({
        kind: 'pair',
        index: (l ?? r).index,
        left: l?.line ?? null,
        right: r?.line ?? null
      })
    }

    removed = []
    added = []
  }

  for (const row of rows) {
    if (row.kind === 'line' && row.line.kind === 'removed') removed.push(row)
    else if (row.kind === 'line' && row.line.kind === 'added') added.push(row)
    else {
      flush()
      out.push(
        row.kind === 'line'
          ? { kind: 'pair', index: row.index, left: row.line, right: row.line }
          : row
      )
    }
  }

  flush()

  return out
}

/** One more step of a fold: ↓ from its top edge, ↑ from its bottom edge, or all of it. */
export function revealMore(reveals: Reveals, fold: FoldRow, how: 'down' | 'up' | 'all'): Reveals {
  const was = reveals[fold.id] ?? { down: 0, up: 0 }

  const next =
    how === 'all' ? REVEAL_ALL : { ...was, [how]: was[how] + Math.min(REVEAL_STEP, fold.hidden) }

  return { ...reveals, [fold.id]: next }
}

/** Opens the comment-only changes a fold took in, so they show as changes of their own. */
export function revealComments(reveals: Reveals, fold: FoldRow): Reveals {
  const ids = fold.comments?.ids ?? []

  return { ...reveals, ...Object.fromEntries(ids.map((id) => [id, REVEAL_ALL])) }
}

/** Opens a folded run of comment lines, or folds an open one again. */
export function toggleCommentRun(reveals: Reveals, row: CommentRunRow): Reveals {
  if (!(row.id in reveals)) return { ...reveals, [row.id]: REVEAL_ALL }
  const next = { ...reveals }
  delete next[row.id]

  return next
}

/**
 * Reveals with the fold that hides line `n` of the new file opened whole, so a line comment's
 * line can be shown; the same object when no fold hides it. A run of comment lines that holds
 * it opens by itself once `n` is among the view's targets.
 */
export function revealLine(
  file: WorkspaceDiffFile,
  reveals: Reveals,
  n: number,
  view: CommentView
): Reveals {
  if (!file.fullContext) return reveals
  const p = plan(file, reveals, view)
  const at = p.lines.findIndex((l) => l.new === n)

  if (at < 0) return reveals

  for (const run of p.folds) {
    const id = runId(run)
    const { from, to } = hiddenRange(run, p.lines.length, reveals[id])

    if (at >= from && at < to) return { ...reveals, [id]: REVEAL_ALL }
  }

  return reveals
}
