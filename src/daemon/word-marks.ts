// Word-level marks on changed lines: within a change block (removed lines
// followed by added lines), the i-th removed line is paired with the i-th added
// line, and the words that differ between the two are marked on each.
import { diffWordsWithSpace } from 'diff'
import { type DiffLine, type DiffToken, lineText } from '../shared/protocol'

/** A half-open character range of a line. */
export interface CharRange {
  start: number
  end: number
}

/** Pairs sharing less than this share of their characters are not marked: the whole line changed. */
export const MIN_SHARED = 0.3

/** Lines longer than this are not word-diffed. */
const MAX_LINE_CHARS = 2_000

/** What one file may spend on word marks; past it, the remaining pairs are left unmarked. */
export interface MarkBudget {
  /** Characters of paired lines still allowed. */
  chars: number
  /** Pairs still allowed. */
  pairs: number
}

/** A file's word-mark budget: a huge rewrite never stalls the daemon on word diffs. */
export const markBudget = (): MarkBudget => ({ chars: 200_000, pairs: 2_000 })

/**
 * The ranges of `before` that were removed and of `after` that were added,
 * word by word; null when the two share too little to be worth marking.
 */
export function wordRanges(
  before: string,
  after: string
): { removed: CharRange[]; added: CharRange[] } | null {
  if (before.length > MAX_LINE_CHARS || after.length > MAX_LINE_CHARS) return null
  const removed: CharRange[] = []
  const added: CharRange[] = []
  let oldAt = 0
  let newAt = 0
  let shared = 0

  for (const change of diffWordsWithSpace(before, after)) {
    const n = change.value.length

    if (change.removed) {
      removed.push({ start: oldAt, end: oldAt + n })
      oldAt += n
    } else if (change.added) {
      added.push({ start: newAt, end: newAt + n })
      newAt += n
    } else {
      shared += n
      oldAt += n
      newAt += n
    }
  }

  const total = before.length + after.length

  if (total === 0 || (2 * shared) / total < MIN_SHARED) return null

  return { removed, added }
}

/** Part of a token, `from` to `to` of its text; the token itself when that is all of it, unmarked. */
function slice(t: DiffToken, from: number, to: number, marked: boolean): DiffToken {
  if (!marked && from === 0 && to === t.text.length) return t
  const piece: DiffToken = { text: t.text.slice(from, to), kind: t.kind }

  if (t.depth !== undefined) piece.depth = t.depth

  if (marked) piece.mark = true

  return piece
}

/**
 * The tokens split at the ranges' edges, the parts inside a range marked.
 * `ranges` are sorted and disjoint; tokens outside every range are reused as
 * they are, and the input is never changed.
 */
export function markTokens(
  tokens: readonly DiffToken[],
  ranges: readonly CharRange[]
): DiffToken[] {
  const out: DiffToken[] = []
  let r = 0
  let at = 0

  for (const t of tokens) {
    const end = at + t.text.length
    let pos = at

    while (pos < end) {
      while (r < ranges.length && (ranges[r]?.end ?? 0) <= pos) r += 1
      const range = ranges[r]
      const inside = range !== undefined && range.start <= pos

      // Up to the range's end inside one, else up to the next range's start, within the token.
      const stop =
        !range || range.start >= end ? end : inside ? Math.min(range.end, end) : range.start

      out.push(slice(t, pos - at, stop - at, inside))
      pos = stop
    }

    at = end
  }

  return out
}

/**
 * Marks the changed words of each removed/added pair in every change block,
 * drawing on `budget` (shared by a file's hunks). Returns new lines; a line
 * without marks is the same object as before.
 */
export function markChangeBlocks(
  lines: readonly DiffLine[],
  budget: MarkBudget = markBudget()
): DiffLine[] {
  const out = [...lines]
  let i = 0

  while (i < out.length) {
    if (out[i]?.kind !== 'removed') {
      i += 1
      continue
    }

    const removedStart = i

    while (out[i]?.kind === 'removed') i += 1
    const addedStart = i

    while (out[i]?.kind === 'added') i += 1
    const pairs = Math.min(addedStart - removedStart, i - addedStart)

    for (let k = 0; k < pairs; k++) {
      const before = out[removedStart + k]
      const after = out[addedStart + k]

      if (!before || !after) continue
      const oldText = lineText(before.tokens)
      const newText = lineText(after.tokens)
      budget.pairs -= 1
      budget.chars -= oldText.length + newText.length

      if (budget.pairs < 0 || budget.chars < 0) return out
      const ranges = wordRanges(oldText, newText)

      if (!ranges) continue
      out[removedStart + k] = { ...before, tokens: markTokens(before.tokens, ranges.removed) }
      out[addedStart + k] = { ...after, tokens: markTokens(after.tokens, ranges.added) }
    }
  }

  return out
}
