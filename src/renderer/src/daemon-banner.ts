// The words of the stale-build banner: the update in place it offers first, and
// what the restart it falls back to costs.
import type { Workspace } from '../../preload/index.d'
import type { TermTab } from './store'

export interface RestartCost {
  /** Terminals that are running and would end. */
  terminals: number
  /** Of those, the ones in a workspace whose session is working. */
  working: number
}

/** The running terminals and how many of them sit in a working workspace. */
export function restartCost(
  terminals: readonly TermTab[],
  workspaces: Readonly<Record<string, Workspace>>
): RestartCost {
  const alive = terminals.filter((t) => t.alive)

  return {
    terminals: alive.length,
    working: alive.filter((t) => workspaces[t.key]?.status === 'working').length
  }
}

/** The banner's first sentence: an update in place, which ends nothing. */
export const DAEMON_UPDATE_TEXT =
  'que was updated. The background service is still running the previous build. Update it to pick up the changes; your terminals keep running.'

/** The banner after an update in place failed for `reason`, naming the terminals a restart ends. */
export function daemonRestartText(reason: string, { terminals, working }: RestartCost): string {
  const lead = `The service could not be updated in place: ${reason.trim().replace(/\.+$/, '')}. Restart it instead.`

  if (terminals === 0) return `${lead} No terminals are running.`
  const count = `${terminals} terminal${terminals === 1 ? '' : 's'}`

  return `${lead} This ends ${count}${working > 0 ? ` (${working} working)` : ''}.`
}
