// Domain types shared by the daemon, CLI, and renderer. Tasks and quiet hours
// are placeholders until those features land.

export type WorkspaceStatus = 'preparing' | 'idle' | 'working' | 'needs_input' | 'stuck' | 'exited'

/** A git repository registered with que. */
export interface Project {
  id: string
  name: string
  /** The main checkout (git toplevel). */
  path: string
  defaultBranch: string
  createdAt: string
}

/** A git worktree on its own branch, with its own terminals and status. */
export interface Workspace {
  id: string
  projectId: string
  name: string
  branch: string
  path: string
  baseRef: string
  status: WorkspaceStatus
  /** Why it is stuck: `no_heartbeat`, `setup_failed`, `error:<kind>`. */
  statusReason: string | null
  statusAt: string
  lastActivityAt: string | null
  /** The Claude Code session last seen reporting from this workspace. */
  sessionId: string | null
  createdAt: string
  archivedAt: string | null
}

/** Workspace counts per status, for the tray and `que status`. */
export type StatusSummary = Record<WorkspaceStatus, number>

export type TaskState =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'paused'
  | 'finishing'
  | 'done'
  | 'stuck'
  | 'failed'

export interface Task {
  id: string
  workspaceId: string
  title: string
  state: TaskState
  prUrl?: string
  cost: number
  turns: number
  createdAt: string
}

/** Quiet window in local wall-clock time, `HH:MM`. */
export interface QuietWindow {
  start: string
  end: string
}

export interface QueConfig {
  quiet: QuietWindow & { overrides?: Partial<Record<string, QuietWindow>> }
  caps: { maxTurns: number; maxCostUsd: number }
  stallTimeoutMs: number
}
