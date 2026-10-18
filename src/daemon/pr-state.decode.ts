// Decodes one item of `gh pr list --json number,url,title,state,isDraft,
// reviewDecision,statusCheckRollup,mergedAt,updatedAt,additions,deletions` (or
// `gh pr view <n> --json` with the same fields) into typed fields.
// Missing or mistyped fields read as empty; pr-state.ts maps the result onto
// the PullRequest que keeps.
import { isObj, type Obj, strOrEmpty, strOrNull } from '../shared/json.decode'

/** A check run in the rollup (GitHub Actions and other apps). */
export interface GhCheckRun {
  kind: 'run'
  name: string
  workflowName: string | null
  /** QUEUED, IN_PROGRESS, COMPLETED, ...; empty when missing. */
  status: string
  /** SUCCESS, FAILURE, SKIPPED, ...; empty while running. */
  conclusion: string
  detailsUrl: string | null
  startedAt: string | null
  completedAt: string | null
}

/** A commit status in the rollup. */
export interface GhStatusContext {
  kind: 'status'
  name: string
  /** SUCCESS, FAILURE, ERROR, PENDING, EXPECTED; empty when missing. */
  state: string
  targetUrl: string | null
  createdAt: string | null
}

export type GhCheck = GhCheckRun | GhStatusContext

export interface GhPullRequest {
  number: number
  url: string
  title: string
  /** OPEN, CLOSED or MERGED; empty when missing. */
  state: string
  isDraft: boolean
  mergedAt: string | null
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED; empty when there is none. */
  reviewDecision: string
  updatedAt: string | null
  /** Lines added and removed; null when gh did not print them. */
  additions: number | null
  deletions: number | null
  checks: GhCheck[]
}

/** One rollup item; null when it is neither a check run nor a commit status. */
function decodeCheck(i: Obj): GhCheck | null {
  const statusContext =
    i.__typename === 'StatusContext' ||
    (i.__typename !== 'CheckRun' && 'state' in i && !('status' in i) && !('conclusion' in i))

  if (statusContext) {
    return {
      kind: 'status',
      name: strOrEmpty(i.context) || strOrEmpty(i.name),
      state: strOrEmpty(i.state),
      targetUrl: strOrNull(i.targetUrl),
      createdAt: strOrNull(i.createdAt)
    }
  }

  const checkRun = i.__typename === 'CheckRun' || 'status' in i || 'conclusion' in i

  if (!checkRun) return null

  return {
    kind: 'run',
    name: strOrEmpty(i.name) || strOrEmpty(i.context),
    workflowName: strOrNull(i.workflowName),
    status: strOrEmpty(i.status),
    conclusion: strOrEmpty(i.conclusion),
    detailsUrl: strOrNull(i.detailsUrl),
    startedAt: strOrNull(i.startedAt),
    completedAt: strOrNull(i.completedAt)
  }
}

/** The `statusCheckRollup` list; items it does not recognise are dropped. */
export function decodeCheckRollup(v: unknown): GhCheck[] {
  if (!Array.isArray(v)) return []
  const checks: GhCheck[] = []

  for (const i of v) {
    const check = isObj(i) ? decodeCheck(i) : null

    if (check) checks.push(check)
  }

  return checks
}

/** The head branch of one `gh pr list` item (asked for with `headRefName`); null without one. */
export function decodeHeadRef(v: unknown): string | null {
  return isObj(v) ? strOrNull(v.headRefName) : null
}

const countOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** One `gh pr list` item; null when it has no number or url. */
export function decodePullRequest(v: unknown): GhPullRequest | null {
  if (!isObj(v)) return null

  if (typeof v.number !== 'number' || typeof v.url !== 'string' || !v.url) return null

  return {
    number: v.number,
    url: v.url,
    title: strOrEmpty(v.title),
    state: strOrEmpty(v.state),
    isDraft: v.isDraft === true,
    mergedAt: strOrNull(v.mergedAt),
    reviewDecision: strOrEmpty(v.reviewDecision),
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : null,
    additions: countOrNull(v.additions),
    deletions: countOrNull(v.deletions),
    checks: decodeCheckRollup(v.statusCheckRollup)
  }
}

/** Every pull request in what `gh pr list` printed; items without a number or url are dropped. */
export function decodePullRequests(v: unknown): GhPullRequest[] {
  if (!Array.isArray(v)) return []
  const out: GhPullRequest[] = []

  for (const item of v) {
    const pr = decodePullRequest(item)

    if (pr) out.push(pr)
  }

  return out
}

/** The number at the end of a pull request URL (`.../pull/<n>`); null for anything else. */
export function decodePrUrlNumber(url: string): number | null {
  const m = /\/pull\/(\d+)\/?$/.exec(url)

  return m ? Number(m[1]) : null
}
