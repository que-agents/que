// The words of the stale-build banner: what restarting the background service costs.
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

/** The banner's sentence, naming the terminals a restart ends. */
export function daemonBannerText({ terminals, working }: RestartCost): string {
  const lead =
    'que was updated. The background service is still running the previous build. Restart it to pick up the changes.'

  if (terminals === 0) return `${lead} No terminals are running.`
  const count = `${terminals} terminal${terminals === 1 ? '' : 's'}`

  return `${lead} This ends ${count}${working > 0 ? ` (${working} working)` : ''}.`
}
