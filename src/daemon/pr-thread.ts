// Maps a pull request's conversation, as the GitHub CLI reports it, onto the
// PrThread que shows: issue comments and reviews from `gh pr view --json
// comments,reviews`, line comments from the REST `pulls/{n}/comments` list.
import type { PrThread, PrThreadEntry, ReviewState } from '../shared/types'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const objects = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null)

const idOf = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : ''

function authorOf(v: unknown): string {
  return (isObj(v) && str(v.login)) || 'unknown'
}

const REVIEW_STATES: Record<string, ReviewState> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
  PENDING: 'pending'
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

/** The pull request's conversation, oldest first. Garbage items are skipped. */
export function parsePrThread(
  view: unknown,
  lineComments: unknown,
  workspaceId: string,
  number: number,
  fetchedAt: string
): PrThread {
  const v = isObj(view) ? view : {}
  const entries: PrThreadEntry[] = []

  for (const c of objects(v.comments)) {
    entries.push(
      entry('comment', {
        id: `comment:${idOf(c.id)}`,
        author: authorOf(c.author),
        body: str(c.body),
        at: str(c.createdAt),
        url: strOrNull(c.url)
      })
    )
  }

  for (const r of objects(v.reviews)) {
    const state = REVIEW_STATES[str(r.state)] ?? 'commented'
    const body = str(r.body)

    // GitHub wraps every batch of line comments in an empty COMMENTED review.
    if (state === 'commented' && !body.trim()) continue
    entries.push(
      entry('review', {
        id: `review:${idOf(r.id)}`,
        author: authorOf(r.author),
        body,
        at: str(r.submittedAt),
        url: strOrNull(r.url),
        state
      })
    )
  }

  for (const l of objects(lineComments)) {
    entries.push(
      entry('line', {
        id: `line:${idOf(l.id)}`,
        author: authorOf(l.user),
        body: str(l.body),
        at: str(l.created_at),
        url: strOrNull(l.html_url),
        path: strOrNull(l.path),
        line: numOrNull(l.line) ?? numOrNull(l.original_line),
        hunk: strOrNull(l.diff_hunk)
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
