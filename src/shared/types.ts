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

/** Background work the session reported still running at its last turn end (Stop). */
export interface BackgroundTask {
  /** The task id the CLI reported. */
  id: string
  /** `shell`, `subagent`, `monitor`, `workflow`, `teammate`, or whatever the CLI calls it. */
  kind: string
  description: string
  /** When the daemon first saw it (ISO). */
  since: string
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
  /**
   * The current pull request, as last seen on GitHub: the open or draft one among `prs`, else
   * the most recently updated; null when there is none.
   */
  pr: PullRequest | null
  /**
   * Every pull request opened from this workspace: those whose head is its branch, plus the one
   * workspace.createPr recorded as its `prUrl`. Newest first by number, at most 10.
   */
  prs: PullRequest[]
  /** When its last turn ended (working to idle); null before one has. */
  finishedAt: string | null
  /** When the app last had it selected in a focused window (workspace.seen); null before. */
  seenAt: string | null
  /** Still running after the last turn ended; agent-like kinds keep the status working, shell and monitor do not. */
  backgroundTasks: BackgroundTask[]
  /** What the work is, in a line (shown instead of the name); absent for a workspace made from a name. */
  title?: string
  /** The description the workspace was made from (written to `.que/brief.md`). */
  brief?: string
  /**
   * Where the title came from: the brief's first line, the session's own terminal title, or
   * the user (an explicit title or a rename, which stops automatic updates).
   */
  titleSource?: TitleSource
}

/** Where a workspace's title came from. */
export const TITLE_SOURCES = ['brief', 'terminal', 'user'] as const

export type TitleSource = (typeof TITLE_SOURCES)[number]

export type CheckState = 'pending' | 'passing' | 'failing' | 'skipped'

/** One check run or commit status on the pull request's head. */
export interface PrCheck {
  name: string
  /** The workflow or app that reported it, when known. */
  source: string | null
  state: CheckState
  url: string | null
  startedAt: string | null
  completedAt: string | null
}

export type ReviewState = 'approved' | 'changes_requested' | 'commented' | 'dismissed' | 'pending'

/** One entry of a pull request's conversation: an issue comment, a review, or a review comment on a line. */
export interface PrThreadEntry {
  id: string
  kind: 'comment' | 'review' | 'line'
  author: string
  body: string
  /** When it was posted (ISO). */
  at: string
  url: string | null
  /** Reviews only. */
  state: ReviewState | null
  /** Line comments only. */
  path: string | null
  line: number | null
  hunk: string | null
}

export interface PrThread {
  workspaceId: string
  number: number
  /** Oldest first. */
  entries: PrThreadEntry[]
  fetchedAt: string
}

/** The state of a workspace's pull request, refreshed by the daemon. */
export interface PullRequest {
  url: string
  number: number
  title: string
  state: 'draft' | 'open' | 'merged' | 'closed'
  /** Combined status checks on the head commit. */
  checks: 'none' | 'pending' | 'passing' | 'failing'
  /** The review decision, or null when no review is required yet. */
  review: 'approved' | 'changes_requested' | 'review_required' | null
  /** The individual check runs behind `checks`. */
  checkRuns: PrCheck[]
  /** When the pull request last changed on GitHub (ISO), or null when unknown. */
  updatedAt: string | null
  /** Lines added and removed across the pull request, or null when unknown. */
  additions: number | null
  deletions: number | null
  /** When que last refreshed this from GitHub. */
  checkedAt: string
}

/** Workspace counts per status, for the tray and `que status`. */
export type StatusSummary = Record<WorkspaceStatus, number>

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

/** A ticket assigned to the user in the issue tracker, as last synced. */
/** Where a ticket sits in the tracker's hierarchy. */
export type TicketLevel = 'epic' | 'standard' | 'subtask'

export interface Ticket {
  key: string
  summary: string
  status: string
  statusCategory: 'new' | 'indeterminate' | 'done' | 'unknown'
  priority: string | null
  type: string
  /** An epic, a standard issue, or a subtask of one. */
  level: TicketLevel
  /** The key of the ticket this one sits under, when known. */
  parentKey: string | null
  /** False for a parent que knows only through its children (not in the search). */
  assigned: boolean
  assignee: string | null
  projectKey: string
  projectName: string
  /** The ticket's page in the tracker. */
  url: string
  labels: string[]
  updatedAt: string | null
  /** When que last synced this ticket. */
  syncedAt: string
  /** The workspace started for it from que, if any. */
  workspaceId: string | null
}

/** How the last ticket sync went. */
export interface TicketsSyncState {
  lastSyncAt: string | null
  /** Why the last sync failed, or null. */
  error: string | null
  count: number
}

/** The `[jira]` table of the config file. */
export interface JiraConfig {
  /** The filter for the ticket queue. */
  jql: string
  /** Minutes between syncs. */
  pollMinutes: number
  /** The tracker site host for links; learned from the CLI's auth status when null. */
  site: string | null
  /** The first prompt typed into claude when a ticket is started. */
  startPrompt: string
  /** Tracker project key → que project name, learned when the user picks. */
  projects: Record<string, string>
}

export interface NotificationsConfig {
  /** Chime when a session finishes a turn (work hours only). */
  chimeOnComplete: boolean
  /** Chime when a session needs input (work hours only). */
  chimeOnNeedsInput: boolean
  /**
   * Let the complete chime through during a manual quiet (`que quiet start`).
   * Scheduled quiet hours stay silent, and needs input never chimes in a window.
   */
  chimeInManualQuiet: boolean
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
  /** How often the daemon refreshes each workspace's pull request from GitHub. */
  prPollSeconds: number
  /** Named repositories, so `que work -r <name>` can resolve a name. */
  repos: Record<string, RepoEntry>
  /** Used when a repo's que.toml sets no permission_mode. */
  defaultPermissionMode?: PermissionMode
  /** Required (with the repo opting in) before a workspace session may run with bypassPermissions. */
  allowBypassPermissions: boolean
  /** Branches Create draft PR never pushes, besides each project's default branch. */
  protectedBranches: string[]
  /**
   * A file appended to every interactive session's system prompt inside a
   * workspace (absolute; a leading ~ is expanded). Unset when absent.
   */
  instructionsFile?: string
  quietHours: QuietHoursConfig
  notifications: NotificationsConfig
  jira: JiraConfig
  /** What claude starts on in a workspace made from a brief; empty (the default) means the brief itself. */
  startPrompt: string
}

/** A newer que release, found by the app's daily update check. */
/**
 * The daemon the app is connected to, as the main process last saw it: its
 * version and build id, the build id of the bundle this app would start, and
 * whether they differ (shared/build-id.ts).
 */
export interface DaemonState {
  version: string
  buildId: string
  expectedBuildId: string
  stale: boolean
}

export interface UpdateInfo {
  /** The newer version, without a leading v. */
  version: string
  /** Its release page. */
  url: string
}

/** What the daemon says about quiet hours (quiet.state and the quiet.changed event). */
/** A 24-hour `HH:MM` wall-clock time, as quiet-hours windows are written. */
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** Where a quiet window comes from: the quiet_hours config, or `que quiet start`. */
export type QuietKind = 'scheduled' | 'manual'

export interface QuietState {
  enabled: boolean
  inQuietHours: boolean
  /** The source of the window in progress, else null. */
  kind: QuietKind | null
  /** The window in progress (ISO), else null. */
  windowStart: string | null
  windowEnd: string | null
  /** The next start or end (ISO); null when quiet hours never come. */
  nextBoundary: string | null
  /** While an unlock lasts (ISO), else null. */
  unlockedUntil: string | null
  unlockMinutes: number
  /**
   * True while quiet hours are on and no unlock is running: the one value clients
   * ask before showing the board, refusing a detail command or opening a terminal.
   */
  locked: boolean
}

/** One `que unlock`, from the quiet_unlocks log. */
export interface QuietUnlock {
  at: string
  minutes: number
  why: string | null
  /** When it expired or was locked early; null while it lasts. */
  endedAt: string | null
}

/** Anything `JSON.parse` can return. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

/** `T` as a patch: every key optional, scalars and lists clearable with `null`, nested objects patched in turn. */
type Patch<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K] | null
    : T[K] extends object
      ? Patch<T[K]> | null
      : T[K] | null
}

/**
 * A `config.set` patch: the parts of a `UserConfig` to change, in its camelCase
 * shape. Sections merge key by key, so a patch names only what it sets. A
 * `null` clears a setting back to its default (or removes a weekday override,
 * a ticket project, a configured repo). Mapping to the file's own key names
 * happens in `shared/config-keys.decode.ts`; nothing on the wire knows them.
 */
export type ConfigPatch = Patch<Omit<UserConfig, 'repos' | 'quietHours' | 'jira'>> & {
  /** A configured repo by name; `null` removes it. */
  repos?: Record<string, Patch<RepoEntry> | null>
  quietHours?: Patch<Omit<QuietHoursConfig, 'default' | 'days'>> & {
    default?: QuietWindow | null
    /** A weekday's override; `null` removes it so the default window applies. */
    days?: Partial<Record<Weekday, DayWindow | null>>
  }
  jira?: Patch<Omit<JiraConfig, 'projects'>> & {
    /** Tracker project key to que project name; `null` forgets a key. */
    projects?: Record<string, string | null>
  }
}
