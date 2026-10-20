// Pure entity factories shared by node-side and renderer tests: no node:fs,
// so the renderer's fixtures can re-export them. Realistic values, opaque ids.
import type { BackgroundTask, PrCheck, PrThreadEntry, Ticket, Workspace } from '../shared/types'

let wsCounter = 0
let prEntryCounter = 0
let backgroundCounter = 0

/** A workspace whose branch and worktree path derive from its name, status idle. */
export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  wsCounter += 1
  const name = overrides.name ?? `ha-${1430 + wsCounter}-retry-logic`

  return {
    id: `ws_01hzx${wsCounter.toString(36).padStart(7, '0')}`,
    projectId: 'prj_01hzw7q2m4nb',
    name,
    branch: name,
    path: `/Users/dev/.que/worktrees/uploader/${name}`,
    baseRef: 'origin/main',
    status: 'idle',
    statusReason: null,
    statusAt: '2026-10-13T21:04:30.000Z',
    lastActivityAt: null,
    sessionId: null,
    createdAt: '2026-10-13T21:04:00.000Z',
    archivedAt: null,
    prUrl: null,
    pr: null,
    prs: [],
    finishedAt: null,
    seenAt: null,
    backgroundTasks: [],
    ...overrides
  }
}

/** A background task as the daemon lists it: a dev server shell, unless overridden. */
export function makeBackgroundTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  backgroundCounter += 1

  return {
    id: `b${backgroundCounter.toString(16).padStart(5, '0')}f2e1`,
    kind: 'shell',
    description: 'npm run dev',
    since: '2026-10-13T21:04:00.000Z',
    ...overrides
  }
}

/** A ticket assigned to the user, as tickets.list reports it. */
export function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    key: 'APP-1432',
    summary: 'Add retry logic to the uploader',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    priority: 'Medium',
    type: 'Story',
    level: 'standard',
    parentKey: null,
    assigned: true,
    assignee: 'Ryan',
    projectKey: 'APP',
    projectName: 'Uploader',
    url: 'https://example.atlassian.net/browse/APP-1432',
    labels: [],
    updatedAt: '2026-10-14T01:12:00.000Z',
    syncedAt: '2026-10-14T01:15:00.000Z',
    workspaceId: null,
    ...overrides
  }
}

/** One check run on a pull request's head. */
export function makePrCheck(overrides: Partial<PrCheck> = {}): PrCheck {
  return {
    name: 'build',
    source: 'CI',
    state: 'passing',
    url: 'https://github.com/rquellh/que/actions/runs/1',
    startedAt: '2026-10-14T01:00:00.000Z',
    completedAt: '2026-10-14T01:04:00.000Z',
    ...overrides
  }
}

/** One entry of a pull request's conversation: an issue comment by default. */
export function makePrThreadEntry(overrides: Partial<PrThreadEntry> = {}): PrThreadEntry {
  prEntryCounter += 1

  return {
    id: `c${prEntryCounter}`,
    kind: 'comment',
    author: 'reviewer',
    body: 'Looks good, one question about the retry cap.',
    at: '2026-10-14T02:00:00.000Z',
    url: `https://github.com/rquellh/que/pull/41#issuecomment-${prEntryCounter}`,
    state: null,
    path: null,
    line: null,
    hunk: null,
    ...overrides
  }
}
