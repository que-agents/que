// What the workspace popout says, as pure rules: the path with `~` for the home
// directory and a pull request's first failing check (its state in words is `prBadge`).
// WorkspacePopout.tsx draws them. docs/design.md "Sidebar".
import type { PullRequest } from '../../preload/index.d'

/** `~/…` when the path is under the home directory; the path as it is otherwise. */
export function tildePath(path: string, home: string | null): string {
  if (!home) return path
  const root = home.replace(/\/+$/, '')

  if (path === root) return '~'

  return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path
}

/** The name of the first failing check run, while the checks are failing; else null. */
export function firstFailingCheck(pr: PullRequest): string | null {
  if (pr.checks !== 'failing') return null

  return pr.checkRuns.find((c) => c.state === 'failing')?.name ?? null
}
