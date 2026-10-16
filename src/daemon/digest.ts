// What one workspace did in a report window, as pure functions over its
// status log: time working, how often it asked for input, whether it still
// waits. The daemon gathers the log and repository facts; nothing here does I/O.
import type { WorkspaceDigest } from '../shared/protocol'
import type { Project, Workspace, WorkspaceStatus } from '../shared/types'

export interface StatusLogEntry {
  status: WorkspaceStatus
  reason: string | null
  at: string
}

/** Statuses that keep a workspace in the report even with no change in the window. */
const ATTENTION: ReadonlySet<WorkspaceStatus> = new Set(['working', 'needs_input', 'stuck'])

/**
 * `log` holds every row with `at >= since` plus the last row before it, oldest
 * first. Null when the workspace did nothing in the window and is not active.
 */
export function buildWorkspaceDigest(
  ws: Workspace,
  project: Project,
  log: readonly StatusLogEntry[],
  since: number,
  now: number,
  extras: { commitsAhead: number | null }
): WorkspaceDigest | null {
  const rows = [...log].sort((a, b) => a.at.localeCompare(b.at))
  const inside = rows.filter((r) => Date.parse(r.at) >= since)

  if (inside.length === 0 && !ATTENTION.has(ws.status)) return null

  let workingMs = 0
  let needsInputCount = 0
  let stuckCount = 0
  let prev: WorkspaceStatus | null = null
  rows.forEach((row, i) => {
    const at = Date.parse(row.at)

    if (row.status === 'working') {
      const from = Math.max(at, since)
      const to = Math.min(i + 1 < rows.length ? Date.parse(rows[i + 1].at) : now, now)

      if (to > from) workingMs += to - from
    }

    if (at >= since && row.status !== prev) {
      if (row.status === 'needs_input') needsInputCount += 1

      if (row.status === 'stuck') stuckCount += 1
    }

    prev = row.status
  })

  let waitingSince: string | null = null

  if (ws.status === 'needs_input') {
    waitingSince = ws.statusAt

    for (let i = rows.length - 1; i >= 0 && rows[i].status === 'needs_input'; i--) {
      waitingSince = rows[i].at
    }
  }

  return {
    id: ws.id,
    name: ws.name,
    project: project.name,
    branch: ws.branch,
    status: ws.status,
    statusReason: ws.statusReason,
    firstActivityAt: inside[0]?.at ?? null,
    lastActivityAt: inside.at(-1)?.at ?? null,
    workingMs,
    needsInputCount,
    waitingSince,
    stuckCount,
    commitsAhead: extras.commitsAhead,
    pr: ws.pr,
    sessionId: ws.sessionId
  }
}

const RANK: Partial<Record<WorkspaceStatus, number>> = { needs_input: 0, stuck: 1, working: 2 }

/** Needs input first, then stuck, then working, then the rest; newest activity first in each. */
export function sortDigests(digests: readonly WorkspaceDigest[]): WorkspaceDigest[] {
  return [...digests].sort((a, b) => {
    const r = (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3)

    if (r !== 0) return r

    if (a.lastActivityAt === b.lastActivityAt) return 0

    if (a.lastActivityAt === null) return 1

    if (b.lastActivityAt === null) return -1

    return b.lastActivityAt.localeCompare(a.lastActivityAt)
  })
}
