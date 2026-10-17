// Decodes a pull request's conversation as the GitHub CLI reports it: issue
// comments and reviews from `gh pr view --json comments,reviews`, line comments
// from the REST `pulls/{n}/comments` list. Items that are not objects are
// dropped; missing or mistyped fields read as empty. pr-thread.ts maps the
// result onto the PrThread que shows.
import { isObj, numOrNull, objects, strOrEmpty, strOrNull } from '../shared/json.decode'

/** An issue comment. */
export interface GhComment {
  /** The node id, or a numeric id as text; empty when missing. */
  id: string
  /** The author's login; null when there is none. */
  author: string | null
  body: string
  createdAt: string
  url: string | null
}

/** A review. */
export interface GhReview {
  id: string
  author: string | null
  body: string
  /** APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING; empty when missing. */
  state: string
  submittedAt: string
  url: string | null
}

/** What `gh pr view --json comments,reviews` prints. */
export interface GhPrView {
  comments: GhComment[]
  reviews: GhReview[]
}

/** A review comment on a line. */
export interface GhLineComment {
  id: string
  author: string | null
  body: string
  createdAt: string
  url: string | null
  path: string | null
  line: number | null
  originalLine: number | null
  hunk: string | null
}

const idOf = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : ''

const loginOf = (v: unknown): string | null => (isObj(v) && strOrNull(v.login)) || null

/** The view's comments and reviews; a view that is not an object has neither. */
export function decodePrView(v: unknown): GhPrView {
  const view = isObj(v) ? v : {}

  return {
    comments: objects(view.comments).map((c) => ({
      id: idOf(c.id),
      author: loginOf(c.author),
      body: strOrEmpty(c.body),
      createdAt: strOrEmpty(c.createdAt),
      url: strOrNull(c.url)
    })),
    reviews: objects(view.reviews).map((r) => ({
      id: idOf(r.id),
      author: loginOf(r.author),
      body: strOrEmpty(r.body),
      state: strOrEmpty(r.state),
      submittedAt: strOrEmpty(r.submittedAt),
      url: strOrNull(r.url)
    }))
  }
}

/** The line comments of every page, joined; anything but a list has none. */
export function decodeLineComments(v: unknown): GhLineComment[] {
  return objects(v).map((l) => ({
    id: idOf(l.id),
    author: loginOf(l.user),
    body: strOrEmpty(l.body),
    createdAt: strOrEmpty(l.created_at),
    url: strOrNull(l.html_url),
    path: strOrNull(l.path),
    line: numOrNull(l.line),
    originalLine: numOrNull(l.original_line),
    hunk: strOrNull(l.diff_hunk)
  }))
}
