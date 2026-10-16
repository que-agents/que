// Maps a pull request's conversation, decoded by pr-thread.decode.ts, onto the
// PrThread que shows: issue comments and reviews from `gh pr view --json
// comments,reviews`, line comments from the REST `pulls/{n}/comments` list.
import type { PrThread, PrThreadEntry, ReviewState } from '../shared/types'
import type { GhLineComment, GhPrView } from './pr-thread.decode'

function reviewStateOf(state: string): ReviewState {
  switch (state) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    case 'DISMISSED':
      return 'dismissed'
    case 'PENDING':
      return 'pending'
    default:
      return 'commented'
  }
}

function entry(kind: PrThreadEntry['kind'], fields: Partial<PrThreadEntry>): PrThreadEntry {
  return {
    id: '',
    kind,
    author: 'unknown',
    body: '',
    at: '',
    url: null,
    state: null,
    path: null,
    line: null,
    hunk: null,
    ...fields
  }
}

/** The pull request's conversation, oldest first. */
export function parsePrThread(
  view: GhPrView,
  lineComments: GhLineComment[],
  workspaceId: string,
  number: number,
  fetchedAt: string
): PrThread {
  const entries: PrThreadEntry[] = []

  for (const c of view.comments) {
    entries.push(
      entry('comment', {
        id: `comment:${c.id}`,
        author: c.author ?? 'unknown',
        body: c.body,
        at: c.createdAt,
        url: c.url
      })
    )
  }

  for (const r of view.reviews) {
    const state = reviewStateOf(r.state)

    // GitHub wraps every batch of line comments in an empty COMMENTED review.
    if (state === 'commented' && !r.body.trim()) continue
    entries.push(
      entry('review', {
        id: `review:${r.id}`,
        author: r.author ?? 'unknown',
        body: r.body,
        at: r.submittedAt,
        url: r.url,
        state
      })
    )
  }

  for (const l of lineComments) {
    entries.push(
      entry('line', {
        id: `line:${l.id}`,
        author: l.author ?? 'unknown',
        body: l.body,
        at: l.createdAt,
        url: l.url,
        path: l.path,
        line: l.line ?? l.originalLine,
        hunk: l.hunk
      })
    )
  }

  // Array.prototype.sort is stable, so equal times keep their order above.
  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

  return { workspaceId, number, entries, fetchedAt }
}

/** Splits back-to-back JSON values (`gh api --paginate` prints one per page) and parses each. */
export function jsonPages(text: string): unknown[] {
  const pages: unknown[] = []
  let depth = 0
  let start = -1
  let inString = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') inString = true
    else if (ch === '[' || ch === '{') {
      if (depth++ === 0) start = i
    } else if (ch === ']' || ch === '}') {
      if (--depth === 0) pages.push(JSON.parse(text.slice(start, i + 1)))
    } else if (depth === 0 && !/\s/.test(ch)) throw new Error('not JSON')
  }

  if (depth !== 0 || inString) throw new Error('not JSON')

  return pages
}
