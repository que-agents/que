// The review pane's pull requests, as pure rules: their order, what a pull request merges
// into, whether it came from another worktree, and whether its conversation has news. The
// dot and the checks line are in format.ts. PullRequestList.tsx and PullRequestDetail.tsx
// draw them. docs/design.md "Shapes", the review pane.
import type { PrCheck, PrThreadEntry, PullRequest } from '../../preload/index.d'

/** Open and draft pull requests are still in play; merged and closed ones are settled. */
export function isActive(pr: PullRequest): boolean {
  return pr.state === 'open' || pr.state === 'draft'
}

const newestFirst = (a: PullRequest, b: PullRequest): number => b.number - a.number

/** The list's two groups: open and draft first, then merged and closed, each newest first. */
export interface PrGroups {
  active: PullRequest[]
  settled: PullRequest[]
}

export function orderPrs(prs: readonly PullRequest[]): PrGroups {
  return {
    active: prs.filter(isActive).sort(newestFirst),
    settled: prs.filter((pr) => !isActive(pr)).sort(newestFirst)
  }
}

/** `n open · k failing` in numbers: the open and draft ones, and those of them failing their checks. */
export interface PrCounts {
  open: number
  failing: number
}

export function prCounts(prs: readonly PullRequest[]): PrCounts {
  const active = prs.filter(isActive)

  return { open: active.length, failing: active.filter((pr) => pr.checks === 'failing').length }
}

/**
 * What a pull request merges into: `#n` when its base is another of the session's pull
 * requests' head (a stack; an open one first, then the newest), else the base branch.
 */
export function baseLabel(pr: PullRequest, prs: readonly PullRequest[]): string {
  const under = prs
    .filter((p) => p.number !== pr.number && pr.base !== '' && p.head === pr.base)
    .sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || newestFirst(a, b))[0]

  return under ? `#${under.number}` : pr.base
}

/** Whether a pull request came from another worktree: its head is no branch this one checked out. */
export function fromSubagent(pr: PullRequest, branches: readonly string[]): boolean {
  return pr.head !== '' && !branches.includes(pr.head)
}

/**
 * A pull request's checks as its detail lists them: failing, then running, then skipped runs,
 * each in the order given, and apart from them the passing ones, which fold into one line.
 */
export interface CheckGroups {
  listed: PrCheck[]
  passing: PrCheck[]
}

export function checkGroups(runs: readonly PrCheck[]): CheckGroups {
  const of = (state: PrCheck['state']): PrCheck[] => runs.filter((c) => c.state === state)

  return {
    listed: [...of('failing'), ...of('pending'), ...of('skipped')],
    passing: of('passing')
  }
}

/** `1 failing · 2 running · 6 passing`, zeros left out. */
export interface ChecksCount {
  failing: number
  words: string[]
}

export function checksCount(runs: readonly PrCheck[]): ChecksCount {
  const n = (state: PrCheck['state']): number => runs.filter((c) => c.state === state).length
  const failing = n('failing')

  const words = [
    ...(n('pending') > 0 ? [`${n('pending')} running`] : []),
    ...(n('passing') > 0 ? [`${n('passing')} passing`] : []),
    ...(n('skipped') > 0 ? [`${n('skipped')} skipped`] : [])
  ]

  return { failing, words }
}

/**
 * Whether a pull request's conversation has entries posted after it was last opened
 * (`seenAt`, the newest entry's time then); never opened, any entry is new. Unknown until
 * the daemon has counted its comments.
 */
export function hasNewComments(pr: PullRequest, seenAt: string | undefined): boolean {
  if (pr.commentedAt === null) return false

  return seenAt === undefined || pr.commentedAt > seenAt
}

/** The newest entry's time, what opening a conversation remembers as seen; undefined when empty. */
export function newestAt(entries: readonly PrThreadEntry[]): string | undefined {
  return entries.reduce<string | undefined>(
    (max, e) => (max === undefined || e.at > max ? e.at : max),
    undefined
  )
}
