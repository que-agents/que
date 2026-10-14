// Domain types shared by the daemon, CLI, and renderer.

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
  /** The draft pull request opened from this workspace (workspace.createPr). */
  prUrl: string | null
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

/** A quiet window in local wall-clock time, `HH:MM`; it may cross midnight. */
export interface QuietWindow {
  start: string
  end: string
}

/** Weekday keys of `[quiet_hours]`, indexed like Date#getDay(). */
export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday'
] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** A per-weekday override: its own window, or `none` (no quiet hours that day). */
export type DayWindow = QuietWindow | 'none'

export interface QuietHoursConfig {
  enabled: boolean
  /** The window used on a day without an override. */
  default: QuietWindow
  /** Overrides keyed by the weekday a window starts on. */
  days: Partial<Record<Weekday, DayWindow>>
  /** Length of `que unlock` when no minutes are given. */
  unlockMinutes: number
}

export interface NotificationsConfig {
  /** Chime when a task finishes (work hours only). */
  chimeOnComplete: boolean
  /** Chime when a task needs input (work hours only). */
  chimeOnNeedsInput: boolean
  /** One notification with the night's totals when quiet hours end. */
  morningSummary: boolean
}

/** Claude Code permission modes que may pass with --permission-mode. */
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'
  | 'dontAsk'
  | 'auto'

export interface RepoEntry {
  path: string
  defaultBranch?: string
}

/** The parsed user config (~/.config/que/config.toml or $QUE_CONFIG). */
export interface UserConfig {
  worktreeRoot: string
  stallTimeoutMinutes: number
  statusPollSeconds: number
  /** Named repositories, so `que work -r <name>` can resolve a name. */
  repos: Record<string, RepoEntry>
  /** How many tasks run at once while the queue is open. */
  concurrency: number
  /** Default caps for a task that does not set its own. */
  maxTurns: number
  maxBudgetUsd: number
  /** Used when a repo's que.toml sets no permission_mode. */
  defaultPermissionMode?: PermissionMode
  /** Required (with the repo opting in) before a task may run with bypassPermissions. */
  allowBypassPermissions: boolean
  /** Branches the finisher never pushes, besides each project's default branch. */
  protectedBranches: string[]
  quietHours: QuietHoursConfig
  notifications: NotificationsConfig
}

/** What the daemon says about quiet hours (quiet.state and the quiet.changed event). */
export interface QuietState {
  enabled: boolean
  inQuietHours: boolean
  /** The window in progress (ISO), else null. */
  windowStart: string | null
  windowEnd: string | null
  /** The next start or end (ISO); null when quiet hours never come. */
  nextBoundary: string | null
  /** While an unlock lasts (ISO), else null. */
  unlockedUntil: string | null
  unlockMinutes: number
}

/** One `que unlock`, from the quiet_unlocks log. */
export interface QuietUnlock {
  at: string
  minutes: number
  why: string | null
  /** When it expired or was locked early; null while it lasts. */
  endedAt: string | null
}
