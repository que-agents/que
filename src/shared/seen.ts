// Whether a workspace has something new to look at: it finished (a turn ended, or its
// task did) since the app last had it selected in a focused window. Shared so the
// renderer and the CLI agree. No Node imports.
import type { Workspace } from './types'

/** True when `finishedAt` is later than `seenAt` (or it finished and was never seen). */
export function unseenDone(ws: Pick<Workspace, 'finishedAt' | 'seenAt'>): boolean {
  const finished = ws.finishedAt ? Date.parse(ws.finishedAt) : Number.NaN

  if (!Number.isFinite(finished)) return false
  const seen = ws.seenAt ? Date.parse(ws.seenAt) : Number.NaN

  return !Number.isFinite(seen) || finished > seen
}
