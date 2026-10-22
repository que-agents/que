// What the workspace popout says, as pure rules: the path with `~` for the home
// directory, a pull request's first failing check (its state in words is `prBadge`), and
// the lines of a removal under way. WorkspacePopout.tsx draws them. docs/design.md "Sidebar".
import type { PullRequest } from '../../preload/index.d'
import { formatDuration } from '../../shared/format'
import type { Removal, RemovalStep } from '../../shared/types'

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

/** Where one step of a removal stands, as the card's `[ REMOVING ]` section draws it. */
export type RemovalLine =
  | { step: RemovalStep; state: 'done'; ms: number }
  | { step: RemovalStep; state: 'failed'; ms: number; error: string }
  | { step: RemovalStep; state: 'current' }
  | { step: RemovalStep; state: 'pending' }

/**
 * One line per step in the removal's plan, in order: a finished step is done (or failed,
 * with its reason), the one running now is current, and the rest are pending.
 */
export function removalLines(removal: Removal): RemovalLine[] {
  return removal.plan.map((step): RemovalLine => {
    const result = removal.done.find((r) => r.step === step)

    if (result) {
      return result.error === undefined
        ? { step, state: 'done', ms: result.ms }
        : { step, state: 'failed', ms: result.ms, error: result.error }
    }

    return step === removal.step ? { step, state: 'current' } : { step, state: 'pending' }
  })
}

/** How long a finished step took: tenths under ten seconds (`0.1s`, `2.4s`), else `12s`, `1m 05s`. */
export function formatStepDuration(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100)

  return tenths < 100 ? `${(tenths / 10).toFixed(1)}s` : formatDuration(ms)
}
