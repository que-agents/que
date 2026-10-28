// What a diff tab draws, row by row, from workspace.diffFile's hunks: the lines, the folded runs
// of unchanged lines (whole-file context) or the gaps between hunks, and the same rows paired
// side by side for the split view. Pure: the tab keeps the reveals and renders the rows.
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

/** Per fold id, what has been revealed of it. A fold id outlives nothing but its own run. */
export interface Reveals {
  readonly [foldId: string]: Reveal
}

export const NO_REVEALS: Reveals = {}

export const REVEAL_ALL: Reveal = { down: Infinity, up: Infinity }

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
  hidden: number
  /** Lines ↓ reveals from the top edge, 0 when the run starts the file (no ↓). */
  down: number
  /** Lines ↑ reveals from the bottom edge, 0 when the run ends the file (no ↑). */
  up: number
  /** The line git would name as the enclosing function, '' when none. */
  label: string
}

/** Unchanged lines between hunks the diff does not carry: a count, never expandable. */
export interface GapRow {
  kind: 'gap'
  id: string
  count: number
  label: string
}

export type DiffRow = LineRow | FoldRow | GapRow

/** A split row: the old line at the left, the new at the right; a context line on both. */
export interface PairRow {
  kind: 'pair'
  /** The index of its first line: a stable key. */
  index: number
  left: DiffLine | null
  right: DiffLine | null
}

export type SplitRow = PairRow | FoldRow | GapRow

/** Every line of the file, all hunks in order. */
export function fileLines(file: WorkspaceDiffFile): DiffLine[] {
  return file.hunks.flatMap((h) => h.lines)
}

interface Run {
  start: number
  end: number
}

/** The maximal runs of unchanged lines longer than FOLD_MIN. */
function longRuns(lines: readonly DiffLine[]): Run[] {
  const runs: Run[] = []
  let start = -1

  for (let i = 0; i <= lines.length; i++) {
    const context = i < lines.length && lines[i].kind === 'context'

    if (context && start < 0) start = i

    if (!context && start >= 0) {
      if (i - start > FOLD_MIN) runs.push({ start, end: i })
      start = -1
    }
  }

  return runs
}

/** git's default function line: one that starts with a letter, `_` or `$`. */
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

/**
 * The rows of the unified view. With whole-file context, each run of unchanged lines longer
 * than FOLD_MIN folds, leaving FOLD_CONTEXT lines on each side that touches a change, less
 * whatever `reveals` uncovered; without it, each gap before or between hunks is a count.
 */
export function diffRows(file: WorkspaceDiffFile, reveals: Reveals = NO_REVEALS): DiffRow[] {
  if (!file.fullContext) return gappedRows(file)
  const lines = fileLines(file)
  const labels = functionLabels(lines)
  const rows: DiffRow[] = []
  let next = 0

  const push = (to: number): void => {
    for (; next < to; next++) rows.push({ kind: 'line', index: next, line: lines[next] })
  }

  for (const run of longRuns(lines)) {
    const id = `${run.start}:${run.end}`
    const { from, to, above, below } = hiddenRange(run, lines.length, reveals[id])

    if (to - from <= 0) continue
    push(from)
    const hidden = to - from
    rows.push({
      kind: 'fold',
      id,
      hidden,
      down: above ? Math.min(REVEAL_STEP, hidden) : 0,
      up: below ? Math.min(REVEAL_STEP, hidden) : 0,
      label: labels[to - 1]
    })
    next = to
  }

  push(lines.length)

  return rows
}

function gappedRows(file: WorkspaceDiffFile): DiffRow[] {
  const rows: DiffRow[] = []
  let index = 0
  let end = 0

  file.hunks.forEach((h, i) => {
    const count = linesBefore(h) - end

    if (count > 0) rows.push({ kind: 'gap', id: `gap:${i}`, count, label: h.label })

    for (const line of h.lines) rows.push({ kind: 'line', index: index++, line })
    end = linesBefore(h) + h.newLines
  })

  return rows
}

/**
 * The unified rows side by side: a context line on both sides; within a change, the i-th
 * removed line beside the i-th added one, and nothing beside the rest. Folds and gaps stay.
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

/**
 * Reveals with the fold that hides line `n` of the new file opened whole, so a line comment's
 * line can be shown; the same object when no fold hides it.
 */
export function revealLine(file: WorkspaceDiffFile, reveals: Reveals, n: number): Reveals {
  if (!file.fullContext) return reveals
  const lines = fileLines(file)
  const at = lines.findIndex((l) => l.new === n)

  if (at < 0) return reveals

  for (const run of longRuns(lines)) {
    const id = `${run.start}:${run.end}`
    const { from, to } = hiddenRange(run, lines.length, reveals[id])

    if (at >= from && at < to) return { ...reveals, [id]: REVEAL_ALL }
  }

  return reveals
}
