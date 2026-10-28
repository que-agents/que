// Word-level marks on changed lines: within a change block (removed lines
// followed by added lines), the i-th removed line is paired with the i-th added
// line, and the words that differ between the two are marked on each.
import { diffWordsWithSpace } from 'diff'
import type { DiffLine, DiffToken } from '../shared/protocol'

/** A half-open character range of a line. */
export interface CharRange {
  start: number
  end: number
}

/** Pairs sharing less than this share of their characters are not marked: the whole line changed. */
export const MIN_SHARED = 0.3

/** Lines longer than this are not word-diffed. */
const MAX_LINE_CHARS = 2_000

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

/** The tokens split at the ranges' edges, the parts inside a range marked. Returns new tokens. */
export function markTokens(
  tokens: readonly DiffToken[],
  ranges: readonly CharRange[]
): DiffToken[] {
  if (ranges.length === 0) return tokens.map((t) => ({ ...t }))
  const inRange = (at: number): boolean => ranges.some((r) => at >= r.start && at < r.end)
  const out: DiffToken[] = []
  let at = 0

  for (const t of tokens) {
    let piece = ''
    let marked = inRange(at)

    const flush = (): void => {
      if (piece === '') return
      const next: DiffToken = { text: piece, kind: t.kind }

      if (t.depth !== undefined) next.depth = t.depth

      if (marked) next.mark = true
      out.push(next)
    }

    for (const ch of t.text) {
      const m = inRange(at)

      if (m !== marked) {
        flush()
        piece = ''
        marked = m
      }

      piece += ch
      at += ch.length
    }

    flush()
  }

  return out
}

const lineText = (l: DiffLine): string => l.tokens.map((t) => t.text).join('')

/** Marks the changed words of each removed/added pair in every change block. Returns new lines. */
export function markChangeBlocks(lines: readonly DiffLine[]): DiffLine[] {
  const out = lines.map((l) => ({ ...l, tokens: l.tokens.map((t) => ({ ...t })) }))
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
      const ranges = wordRanges(lineText(before), lineText(after))

      if (!ranges) continue
      before.tokens = markTokens(before.tokens, ranges.removed)
      after.tokens = markTokens(after.tokens, ranges.added)
    }
  }

  return out
}
