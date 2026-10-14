// Domain types shared by the daemon, CLI, and renderer. Quiet hours
// are a placeholder until that feature lands.

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
  | 'stopped'

/** Where a task's brief came from. */
export type TaskSource = 'prompt' | 'file' | 'handoff'

/** An overnight task: a brief run headless by claude in its own workspace. */
export interface Task {
  id: string
  projectId: string
  /** Null until the runner has prepared (or been given) a workspace. */
  workspaceId: string | null
  title: string
  brief: string
  source: TaskSource
  /** The session the next run resumes (hand-off, crash retry, rate-limit pause). */
  resumeSessionId: string | null
  state: TaskState
  /**
   * Detail for the state: `max_turns`, `max_budget`, `no_heartbeat`, `needs_input`,
   * `crashed`, `execution`, `worktree_refused`, `setup_failed`, `session_active`,
   * `finisher:<step>`, `daemon_restart`, `no_changes`.
   */
  reason: string | null
  sessionId: string | null
  /** The claude process while one runs. */
  pid: number | null
  /** The attempt number of the current (or last) run; automatic re-queues add one. */
  attempts: number
  costUsd: number
  turns: number
  maxTurns: number
  maxBudgetUsd: number
  permissionMode: string | null
  branch: string | null
  prUrl: string | null
  /** The final summary (the result text, else the last assistant text). */
  resultText: string | null
  lastActivityAt: string | null
  startedAt: string | null
  finishedAt: string | null
  pausedUntil: string | null
  createdAt: string
  updatedAt: string
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
