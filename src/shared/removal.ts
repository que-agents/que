// Reading a workspace removal, shared by the daemon, the CLI and the renderer. No Node imports.
import type { Removal, RemovalStep } from './types'

/** The step running now; null once every step has run. */
export function removalStep(r: Removal): RemovalStep | null {
  return r.plan[r.done.length] ?? null
}
