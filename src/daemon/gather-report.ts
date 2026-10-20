// report.get: the morning report over every open workspace's status log in
// the window, each digest with its commits ahead from git. The pure pieces
// live in digest.ts and report.ts; this module gathers their inputs.
import type { Report, WorkspaceDigest } from '../shared/protocol'
import type { Project } from '../shared/types'
import { buildWorkspaceDigest, sortDigests } from './digest'
import { badRequest } from './errors'
import { buildReport, reportSince } from './report'
import type { Store } from './store'
import { commitsAhead, type WorkspaceManager } from './workspaces'

/** The report since `since` (ISO), else since 24 hours ago. */
export async function gatherReport(
  deps: { store: Store; workspaces: WorkspaceManager },
  since?: string
): Promise<Report> {
  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    throw badRequest('since must be an ISO time')
  }

  const now = Date.now()
  const from = reportSince(since, now)
  const pending: Array<Promise<WorkspaceDigest>> = []

  for (const ws of deps.store.listWorkspaces()) {
    let project: Project

    try {
      project = deps.workspaces.project(ws.projectId)
    } catch {
      continue
    }

    const log = deps.store.listStatusLog(ws.id, from)
    const digest = buildWorkspaceDigest(ws, project, log, Date.parse(from), now)

    if (digest) {
      pending.push(commitsAhead(ws, project).then((n) => ({ ...digest, commitsAhead: n })))
    }
  }

  return buildReport(sortDigests(await Promise.all(pending)), from, now)
}
