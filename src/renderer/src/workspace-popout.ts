// What the workspace popout says, as pure rules: the path with `~` for the home
// directory, a pull request's state in words, and its first failing check.
// WorkspacePopout.tsx draws them. docs/design.md "Sidebar".
import type { PullRequest } from '../../preload/index.d'

/** `~/…` when the path is under the home directory; the path as it is otherwise. */
export function tildePath(path: string, home: string | null): string {
  if (!home) return path
  const root = home.replace(/\/+$/, '')

  if (path === root) return '~'

  return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path
}

/**
 * A pull request's state as the card writes it, in the order its tone is chosen
 * (`prBadge`): `merged`, `closed`, `open · checks failing`, `changes requested`,
 * `draft`, `open · checks passing`, `open`.
 */
export function prStateText(pr: PullRequest): string {
  if (pr.state === 'merged' || pr.state === 'closed') return pr.state

  if (pr.checks === 'failing') return `${pr.state} · checks failing`

  if (pr.review === 'changes_requested') return 'changes requested'

  if (pr.state === 'draft' || pr.checks === 'none') return pr.state

  return `${pr.state} · checks ${pr.checks}`
}

/** The name of the first failing check run, while the checks are failing; else null. */
export function firstFailingCheck(pr: PullRequest): string | null {
  if (pr.checks !== 'failing') return null

  return pr.checkRuns.find((c) => c.state === 'failing')?.name ?? null
}

/** Newest first: the highest number on top. */
export function newestPrsFirst(prs: readonly PullRequest[]): PullRequest[] {
  return [...prs].sort((a, b) => b.number - a.number)
}
