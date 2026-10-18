// Wire protocol between the que daemon and its clients (Electron main, CLI).
// Newline-delimited JSON over a unix socket. Requests carry an id; responses
// echo it. Events are server-pushed and carry no id.

import { HOOK_EVENT_NAMES, type HookEventName } from './hook-events'
import { decoders } from './methods.decode'
import type {
  ConfigPatch,
  Project,
  PullRequest,
  QuietState,
  QuietUnlock,
  PrThread,
  Task,
  TaskSource,
  TaskState,
  Ticket,
  TicketsSyncState,
  UserConfig,
  Workspace,
  WorkspaceStatus
} from './types'

export { HOOK_EVENT_NAMES, type HookEventName }

// ---- method types ---------------------------------------------------------

export interface PingResult {
  version: string
  pid: number
  startedAt: string
  nodeVersion: string
  /** The daemon's own PATH, as its child processes see it. */
  path: string
}

export interface TermCreateParams {
  cwd?: string
  cols: number
  rows: number
  name?: string
  /** Program to run instead of the login shell. */
  file?: string
  args?: string[]
}

export interface TermInfo {
  id: string
  name: string
  cwd: string
  cols: number
  rows: number
  pid: number
  alive: boolean
  createdAt: string
  /** Set for terminals opened with workspace.openTerminal. */
  workspaceId?: string
}

export interface TermListParams {
  /** Only the terminals of this workspace. */
  workspaceId?: string
}

export interface TermIdParams {
  id: string
}

export interface TermAttachParams {
  id: string
  cols: number
  rows: number
}

export interface TermAttachResult {
  snapshot: string
  cols: number
  rows: number
}

export interface TermWriteParams {
  id: string
  data: string
}

export interface TermResizeParams {
  id: string
  cols: number
  rows: number
}

export interface TermSnapshotResult {
  /** Escape-sequence serialization suitable for writing into an xterm. */
  serialized: string
  /** Plain text of scrollback + screen, one line per row. */
  text: string
}

export interface Ok {
  ok: true
}

export interface ProjectAddParams {
  /**
   * Exactly one of `path` or `repo` is required.
   * `path`: any path inside the repository; the toplevel is registered.
   * `repo`: what `-r` takes, a repo name from `[repos.<name>]` in the user
   * config (registered under that name) or an existing directory.
   */
  path?: string
  repo?: string
  /** The directory a relative `repo` path is resolved against (the caller's); ignored with `path`. */
  cwd?: string
  name?: string
}

export interface ProjectRemoveParams {
  id: string
  /** Also remove its unarchived workspaces. */
  force?: boolean
}

/**
 * A workspace from a name, or from a title or brief. Without a name it is derived from the
 * title (the brief's first line when no title is given) and suffixed `-2`, `-3`, … on a clash.
 */
export interface WorkspaceCreateParams {
  projectId: string
  /** Slugged; a clash is refused. */
  name?: string
  /** What the work is, in a line; defaults to the brief's first line. */
  title?: string
  /** What the work is; written to `<worktree>/.que/brief.md`. */
  brief?: string
  /** Defaults to origin/<default branch> when that ref exists, else <default branch>. */
  baseRef?: string
  /** Defaults to the workspace name. */
  branch?: string
}

export interface WorkspaceStartParams {
  id: string
  cols?: number
  rows?: number
}

export interface WorkspaceStartResult {
  /** The workspace terminal claude is typed into (its first, or the one opened when there was none). */
  terminal: TermInfo
}

export interface WorkspaceRenameParams {
  id: string
  title: string
  /** A new branch name; only for a branch never pushed to origin. The folder keeps its name. */
  branch?: string
}

export interface WorkspaceListParams {
  projectId?: string
}

export interface WorkspaceRemoveParams {
  id: string
  deleteBranch?: boolean
}

export interface WorkspaceOpenTerminalParams {
  id: string
  cols: number
  rows: number
}

/** One file a workspace changed against its base, committed or not. */
export interface DiffFile {
  path: string
  /** For a rename, where it came from. */
  from: string | null
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
  additions: number
  deletions: number
  /** True while still uncommitted in the worktree. */
  dirty: boolean
  /** The unified patch against the base, or null when binary or too large. */
  patch: string | null
}

/** One commit on the branch ahead of its base. */
export interface DiffCommit {
  sha: string
  /** The first seven characters of `sha`. */
  shortSha: string
  subject: string
  author: string
  /** ISO time of the commit. */
  at: string
}

export interface WorkspaceDiff {
  workspaceId: string
  /** The ref the branch is compared against: the caller's `base`, else origin/<default> when it exists. */
  base: string
  head: string
  commitsAhead: number
  /** The commits in `base..HEAD`, newest first, at most 200. */
  commits: DiffCommit[]
  /** Refs worth comparing against: `base` first, then the default branch here and on origin, then the other branches, at most 50. */
  bases: string[]
  /** The sha the files are narrowed to (that commit's own changes), or null for the whole branch and the working tree. */
  commit: string | null
  files: DiffFile[]
  /**
   * The `base` the caller asked for when it was not a commit (a branch since deleted, say). Then
   * `base` is the default comparison and the diff is against that; null when the requested base
   * was used or none was requested.
   */
  rejectedBase: string | null
  generatedAt: string
}

/** Every tracked and untracked file of a worktree, never the ignored ones. */
export interface WorkspaceFiles {
  workspaceId: string
  /** Relative paths, deduplicated and sorted; at most 20,000. */
  files: string[]
  /** True when the listing was cut at the cap. */
  truncated: boolean
  generatedAt: string
}

/** One file of a worktree, read for the file view. */
export interface WorkspaceFile {
  workspaceId: string
  path: string
  /** The text, or null for a binary file. */
  content: string | null
  /** A NUL byte in the first 8 KB marks a file binary. */
  binary: boolean
  /** Bytes on disk. */
  size: number
  /** True when `content` was cut at MAX_FILE_CHARS (500,000). */
  truncated: boolean
}

export interface WorkspaceCreatePrParams {
  id: string
  /** The commit message for uncommitted changes, and the pull request title. */
  title: string
}

export interface WorkspaceCreatePrResult {
  prUrl: string
}

export interface HookEventParams {
  workspaceId: string
  /** Set when the hook fired inside a headless task run (QUE_TASK_ID). */
  taskId?: string
  /** The hook JSON Claude Code wrote to the hook's stdin. */
  payload: HookEvent
}

export interface TaskAddParams {
  /** Exactly one of projectId (a new workspace per task) or workspaceId (run in it). */
  projectId?: string
  workspaceId?: string
  /** Defaults to the first line of the brief, 80 characters at most. */
  title?: string
  brief: string
  source?: TaskSource
  resumeSessionId?: string
  maxTurns?: number
  maxBudgetUsd?: number
}

export interface TaskListParams {
  state?: TaskState
}

export interface QueueOpenParams {
  /** Overrides the configured concurrency until the queue is closed. */
  concurrency?: number
}

export interface QueueState {
  open: boolean
  concurrency: number
  /** Tasks preparing, running, or finishing. */
  running: number
  queued: number
  paused: number
  /** When the queue was last opened. */
  openedAt: string | null
}

export interface TicketsStartParams {
  key: string
  /** The que project to make the workspace in; omitted means use the learned mapping. */
  projectId?: string
  /** A loose terminal with the brief instead of a workspace. */
  session?: boolean
}

export type TicketsStartResult =
  | { kind: 'workspace'; workspace: Workspace }
  | { kind: 'session'; terminal: TermInfo }
  /** que could not tell which project; the app offers these. */
  | { kind: 'needs_project'; projects: Project[] }

export interface TicketsListResult {
  tickets: Ticket[]
  sync: TicketsSyncState
}

export interface ReportParams {
  /** ISO time; defaults to the last queue.open, else 24 hours ago. */
  since?: string
}

export type ReportGroup = 'done' | 'stuck' | 'failed' | 'stopped' | 'paused' | 'running' | 'queued'

export interface ReportEntry {
  id: string
  title: string
  state: TaskState
  reason: string | null
  workspace: string | null
  workspaceId: string | null
  branch: string | null
  prUrl: string | null
  /** When a paused task's rate limit resets; null unless it is paused on one. */
  pausedUntil: string | null
  durationMs: number | null
  turns: number
  costUsd: number
}

/** What one workspace (an interactive session in its worktree) did in the window. */
export interface WorkspaceDigest {
  id: string
  name: string
  project: string
  branch: string
  status: WorkspaceStatus
  statusReason: string | null
  /** The first and last status change in the window; null when nothing happened. */
  firstActivityAt: string | null
  lastActivityAt: string | null
  /** Time spent in `working` within the window. */
  workingMs: number
  /** How many times it asked for input in the window. */
  needsInputCount: number
  /** Since when it has been waiting, if it is waiting now. */
  waitingSince: string | null
  stuckCount: number
  /** Commits on its branch past the base; null when git could not say. */
  commitsAhead: number | null
  pr: PullRequest | null
  sessionId: string | null
}

export interface Report {
  since: string
  generatedAt: string
  groups: Record<ReportGroup, ReportEntry[]>
  /** Workspaces with activity in the window, those needing attention first. */
  workspaces: WorkspaceDigest[]
  totals: {
    tasks: number
    prs: number
    turns: number
    costUsd: number
    durationMs: number
    workspaces: number
    needsInput: number
  }
}

export interface TaskStatusEvent {
  id: string
  state: TaskState
  reason?: string
  at: string
}

export interface WorkspaceStatusEvent {
  id: string
  status: WorkspaceStatus
  reason?: string
  at: string
}

export interface QuietUnlockParams {
  /** Defaults to quiet_hours.unlock_minutes. */
  minutes?: number
  /** Why, for the unlock log. */
  why?: string
}

export interface QuietLogParams {
  /** ISO time; defaults to everything. */
  since?: string
}

export interface ConfigGetResult {
  /** The config file (QUE_CONFIG or ~/.config/que/config.toml). */
  path: string
  config: UserConfig
  /** The file as a TOML table (snake_case keys), the shape config.set patches. */
  raw: Record<string, unknown>
}

export interface ConfigSetParams {
  /** Deep-merged into the file's table; `null` removes a key. */
  patch: ConfigPatch
  /** Let a change that shortens or removes tonight's window apply now. */
  applyTonight?: boolean
}

/** The instructions file (instructions_file) appended to every session's system prompt. */
export interface InstructionsGetResult {
  /** The configured path, absolute; absent when instructions_file is unset. */
  path?: string
  exists: boolean
  /** The file's text; '' when it does not exist. */
  content: string
}

export interface InstructionsSetParams {
  content: string
}

/** Maps each method name to its params and result types. */
export interface Methods {
  'daemon.ping': { params: Record<string, never> | undefined; result: PingResult }
  'daemon.shutdown': { params: Record<string, never> | undefined; result: Ok }
  'term.create': { params: TermCreateParams; result: TermInfo }
  'term.list': { params: TermListParams | undefined; result: TermInfo[] }
  'term.attach': { params: TermAttachParams; result: TermAttachResult }
  'term.detach': { params: TermIdParams; result: Ok }
  'term.write': { params: TermWriteParams; result: Ok }
  'term.resize': { params: TermResizeParams; result: Ok }
  'term.kill': { params: TermIdParams; result: Ok }
  'term.snapshot': { params: TermIdParams; result: TermSnapshotResult }
  'project.add': { params: ProjectAddParams; result: Project }
  'project.list': { params: Record<string, never> | undefined; result: Project[] }
  'project.remove': { params: ProjectRemoveParams; result: Ok }
  'workspace.create': { params: WorkspaceCreateParams; result: Workspace }
  'workspace.list': { params: WorkspaceListParams | undefined; result: Workspace[] }
  'workspace.get': { params: { id: string }; result: Workspace }
  'workspace.remove': { params: WorkspaceRemoveParams; result: Ok }
  'workspace.openTerminal': { params: WorkspaceOpenTerminalParams; result: TermInfo }
  'workspace.createPr': { params: WorkspaceCreatePrParams; result: WorkspaceCreatePrResult }
  /** Types `claude '<start_prompt>'` into the workspace's first terminal once setup is done. */
  'workspace.start': { params: WorkspaceStartParams; result: WorkspaceStartResult }
  /** Sets the title (and, when allowed and asked, renames the branch); emits workspace.updated. */
  'workspace.rename': { params: WorkspaceRenameParams; result: Workspace }
  /** Whether workspace.rename may rename the branch: it has no `origin/<branch>`. */
  'workspace.canRenameBranch': { params: { id: string }; result: { allowed: boolean } }
  /** What the workspace changed against its base: committed and uncommitted, file by file. */
  'workspace.diff': {
    params: { id: string; base?: string; commit?: string }
    result: WorkspaceDiff
  }
  /** The pull request's conversation (comments, reviews, line comments); null without a pull request. */
  'workspace.prThread': { params: { id: string; refresh?: boolean }; result: PrThread | null }
  'workspace.files': { params: { id: string }; result: WorkspaceFiles }
  'workspace.readFile': { params: { id: string; path: string }; result: WorkspaceFile }
  /**
   * Watch this workspace's worktree for this connection (`workspace.changed`).
   * The daemon watches exactly what clients ask for here, whatever terminals
   * they attach to; a connection's watches end with `workspace.unwatch` or when
   * it closes.
   */
  'workspace.watch': { params: { id: string }; result: Ok }
  'workspace.unwatch': { params: { id: string }; result: Ok }
  'hook.event': { params: HookEventParams; result: Ok }
  'task.add': { params: TaskAddParams; result: Task }
  'task.list': { params: TaskListParams | undefined; result: Task[] }
  'task.get': { params: { id: string }; result: Task }
  'task.stop': { params: { id: string }; result: Task }
  'task.remove': { params: { id: string }; result: Ok }
  'queue.open': { params: QueueOpenParams | undefined; result: QueueState }
  'queue.close': { params: Record<string, never> | undefined; result: QueueState }
  'queue.state': { params: Record<string, never> | undefined; result: QueueState }
  'report.get': { params: ReportParams | undefined; result: Report }
  'quiet.state': { params: Record<string, never> | undefined; result: QuietState }
  'quiet.unlock': { params: QuietUnlockParams | undefined; result: QuietState }
  'quiet.lock': { params: Record<string, never> | undefined; result: QuietState }
  'quiet.log': { params: QuietLogParams | undefined; result: QuietUnlock[] }
  'config.get': { params: Record<string, never> | undefined; result: ConfigGetResult }
  'config.set': { params: ConfigSetParams; result: ConfigGetResult }
  'instructions.get': { params: Record<string, never> | undefined; result: InstructionsGetResult }
  /** Writes the instructions file; `not_configured` when instructions_file is unset. */
  'instructions.set': { params: InstructionsSetParams; result: InstructionsGetResult }
  'tickets.list': { params: Record<string, never> | undefined; result: TicketsListResult }
  'tickets.sync': { params: Record<string, never> | undefined; result: TicketsListResult }
  'tickets.start': { params: TicketsStartParams; result: TicketsStartResult }
  'tickets.projectFor': { params: { key: string }; result: { projectId: string | null } }
}

export type MethodName = keyof Methods

export type ParamsOf<M extends MethodName> = Methods[M]['params']

export type ResultOf<M extends MethodName> = Methods[M]['result']

/**
 * The one runtime list of methods, in the order of `Methods`; the mapped type
 * makes a missing or extra entry a compile error.
 *
 * - `renderer`: the app's window may call it (Electron main enforces this). False for
 *   the calls only the daemon's own tooling makes: ping, shutdown, and hook events.
 * - `quiet`: refused with `quiet_hours` while quiet hours are on and not unlocked:
 *   every way to see a terminal, its output, or a report, or to start new work.
 * - `decode`: reads and checks the params a client sent; throws `ParamsError`.
 */
export const METHODS: {
  [M in MethodName]: {
    renderer: boolean
    quiet: boolean
    decode: (p: Record<string, unknown> | undefined) => ParamsOf<M>
  }
} = {
  'daemon.ping': { renderer: false, quiet: false, decode: decoders['daemon.ping'] },
  'daemon.shutdown': {
    renderer: false,
    quiet: false,
    decode: decoders['daemon.shutdown']
  },
  'term.create': { renderer: true, quiet: true, decode: decoders['term.create'] },
  'term.list': { renderer: true, quiet: false, decode: decoders['term.list'] },
  'term.attach': { renderer: true, quiet: true, decode: decoders['term.attach'] },
  'term.detach': { renderer: true, quiet: false, decode: decoders['term.detach'] },
  'term.write': { renderer: true, quiet: false, decode: decoders['term.write'] },
  'term.resize': { renderer: true, quiet: false, decode: decoders['term.resize'] },
  'term.kill': { renderer: true, quiet: false, decode: decoders['term.kill'] },
  'term.snapshot': { renderer: true, quiet: true, decode: decoders['term.snapshot'] },
  'project.add': { renderer: true, quiet: false, decode: decoders['project.add'] },
  'project.list': { renderer: true, quiet: false, decode: decoders['project.list'] },
  'project.remove': { renderer: true, quiet: false, decode: decoders['project.remove'] },
  'workspace.create': {
    renderer: true,
    quiet: false,
    decode: decoders['workspace.create']
  },
  'workspace.list': { renderer: true, quiet: false, decode: decoders['workspace.list'] },
  'workspace.get': { renderer: true, quiet: false, decode: decoders['workspace.get'] },
  'workspace.remove': {
    renderer: true,
    quiet: false,
    decode: decoders['workspace.remove']
  },
  'workspace.openTerminal': {
    renderer: true,
    quiet: true,
    decode: decoders['workspace.openTerminal']
  },
  'workspace.createPr': {
    renderer: true,
    quiet: true,
    decode: decoders['workspace.createPr']
  },
  'workspace.start': { renderer: true, quiet: true, decode: decoders['workspace.start'] },
  'workspace.rename': {
    renderer: true,
    quiet: false,
    decode: decoders['workspace.rename']
  },
  'workspace.canRenameBranch': {
    renderer: true,
    quiet: false,
    decode: decoders['workspace.canRenameBranch']
  },
  'workspace.diff': { renderer: true, quiet: true, decode: decoders['workspace.diff'] },
  'workspace.prThread': {
    renderer: true,
    quiet: true,
    decode: decoders['workspace.prThread']
  },
  'workspace.files': { renderer: true, quiet: true, decode: decoders['workspace.files'] },
  'workspace.readFile': {
    renderer: true,
    quiet: true,
    decode: decoders['workspace.readFile']
  },
  'workspace.watch': {
    renderer: true,
    quiet: false,
    decode: decoders['workspace.watch']
  },
  'workspace.unwatch': {
    renderer: true,
    quiet: false,
    decode: decoders['workspace.unwatch']
  },
  'hook.event': { renderer: false, quiet: false, decode: decoders['hook.event'] },
  'task.add': { renderer: true, quiet: true, decode: decoders['task.add'] },
  'task.list': { renderer: true, quiet: false, decode: decoders['task.list'] },
  'task.get': { renderer: true, quiet: false, decode: decoders['task.get'] },
  'task.stop': { renderer: true, quiet: false, decode: decoders['task.stop'] },
  'task.remove': { renderer: true, quiet: false, decode: decoders['task.remove'] },
  'queue.open': { renderer: true, quiet: true, decode: decoders['queue.open'] },
  'queue.close': { renderer: true, quiet: false, decode: decoders['queue.close'] },
  'queue.state': { renderer: true, quiet: false, decode: decoders['queue.state'] },
  'report.get': { renderer: true, quiet: true, decode: decoders['report.get'] },
  'quiet.state': { renderer: true, quiet: false, decode: decoders['quiet.state'] },
  'quiet.unlock': { renderer: true, quiet: false, decode: decoders['quiet.unlock'] },
  'quiet.lock': { renderer: true, quiet: false, decode: decoders['quiet.lock'] },
  'quiet.log': { renderer: true, quiet: false, decode: decoders['quiet.log'] },
  'config.get': { renderer: true, quiet: false, decode: decoders['config.get'] },
  'config.set': { renderer: true, quiet: false, decode: decoders['config.set'] },
  'instructions.get': {
    renderer: true,
    quiet: false,
    decode: decoders['instructions.get']
  },
  'instructions.set': {
    renderer: true,
    quiet: false,
    decode: decoders['instructions.set']
  },
  'tickets.list': { renderer: true, quiet: false, decode: decoders['tickets.list'] },
  'tickets.sync': { renderer: true, quiet: false, decode: decoders['tickets.sync'] },
  'tickets.start': { renderer: true, quiet: true, decode: decoders['tickets.start'] },
  'tickets.projectFor': {
    renderer: true,
    quiet: false,
    decode: decoders['tickets.projectFor']
  }
}

const METHOD_NAMES = Object.keys(METHODS) as MethodName[]

/** Methods refused with `quiet_hours` while quiet hours are on and not unlocked. */
export const QUIET_REFUSED_METHODS: readonly MethodName[] = METHOD_NAMES.filter(
  (m) => METHODS[m].quiet
)

/** Methods the app's window may call. */
export const RENDERER_METHODS: ReadonlySet<MethodName> = new Set(
  METHOD_NAMES.filter((m) => METHODS[m].renderer)
)

// ---- event types ----------------------------------------------------------

export interface Events {
  'term.data': { id: string; data: string }
  'term.exit': { id: string; exitCode: number; signal?: number }
  'term.created': TermInfo
  'term.killed': { id: string }
  'workspace.created': Workspace
  /** Its pull request (prUrl), title (a rename or a background summary), or branch changed. */
  'workspace.updated': Workspace
  'workspace.removed': { id: string }
  'workspace.status': WorkspaceStatusEvent
  /** Its worktree changed on disk (a write, a commit): the daemon computes nothing until asked. */
  'workspace.changed': { id: string }
  'task.created': Task
  'task.status': TaskStatusEvent
  /** Cost, turns, session, branch, or PR changed. */
  'task.updated': Task
  'queue.state': QueueState
  'project.added': Project
  'project.removed': { id: string }
  'quiet.changed': QuietState
  /** Once, when a quiet window ends and notifications.morning_summary is on. */
  'quiet.morningSummary': { report: Report }
  'config.changed': ConfigGetResult
  /** After every ticket sync, and when a ticket's workspace changes. */
  'tickets.synced': TicketsListResult
}

export type EventName = keyof Events

/**
 * The one runtime list of events, in the order of `Events`.
 *
 * - `renderer`: Electron main forwards it to the app's window. False for events main
 *   handles itself.
 */
export const EVENTS: { [E in EventName]: { renderer: boolean } } = {
  'term.data': { renderer: true },
  'term.exit': { renderer: true },
  'term.created': { renderer: true },
  'term.killed': { renderer: true },
  'workspace.created': { renderer: true },
  'workspace.updated': { renderer: true },
  'workspace.removed': { renderer: true },
  'workspace.status': { renderer: true },
  'workspace.changed': { renderer: true },
  'task.created': { renderer: true },
  'task.status': { renderer: true },
  'task.updated': { renderer: true },
  'queue.state': { renderer: true },
  'project.added': { renderer: true },
  'project.removed': { renderer: true },
  'quiet.changed': { renderer: true },
  'quiet.morningSummary': { renderer: false },
  'config.changed': { renderer: true },
  'tickets.synced': { renderer: true }
}

/** Events forwarded to the app's window. */
export const RENDERER_EVENTS: readonly EventName[] = (Object.keys(EVENTS) as EventName[]).filter(
  (e) => EVENTS[e].renderer
)

// ---- envelopes ------------------------------------------------------------

export interface Request {
  id: number
  method: string
  params?: Record<string, unknown>
}

export interface ResponseError {
  code: string
  message: string
}

export type Response = { id: number; result: unknown } | { id: number; error: ResponseError }

export interface EventMessage {
  event: string
  data: Record<string, unknown>
}

export type ServerMessage = Response | EventMessage

export const ErrorCodes = {
  BadRequest: 'bad_request',
  UnknownMethod: 'unknown_method',
  NotFound: 'not_found',
  Conflict: 'conflict',
  Internal: 'internal',
  QuietHours: 'quiet_hours',
  /** The method needs a config key that is not set (instructions.set without instructions_file). */
  NotConfigured: 'not_configured'
} as const

// ---- framing --------------------------------------------------------------

export function encode(msg: unknown): string {
  return `${JSON.stringify(msg)}\n`
}

/**
 * Splits a byte stream into complete, non-blank lines. Feed it chunks in
 * arrival order; a partial trailing line is kept until its newline arrives.
 * Each chunk is scanned once, so a long line in many chunks costs linear time.
 */
export class LineSplitter {
  /** The pieces of the line in progress, joined when its newline arrives. */
  private pieces: string[] = []

  push(chunk: string): string[] {
    const out: string[] = []
    let start = 0

    for (let nl = chunk.indexOf('\n'); nl !== -1; nl = chunk.indexOf('\n', start)) {
      this.pieces.push(chunk.slice(start, nl))
      this.take(out)
      start = nl + 1
    }

    if (start < chunk.length) this.pieces.push(chunk.slice(start))

    return out
  }

  /** The last line if it never got its newline (call at end of stream). */
  flush(): string[] {
    const out: string[] = []
    this.take(out)

    return out
  }

  private take(out: string[]): void {
    const line = this.pieces.length === 1 ? this.pieces[0] : this.pieces.join('')
    this.pieces = []

    if (line.trim().length > 0) out.push(line)
  }
}

/** Decodes buffered chunks into parsed JSON messages; bad lines go to onError. */
export class MessageDecoder<T = unknown> {
  private lines = new LineSplitter()
  private decoder = new TextDecoder('utf-8')

  constructor(private onError?: (line: string, err: unknown) => void) {}

  push(chunk: string | Uint8Array): T[] {
    const text = typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })

    return this.parse(this.lines.push(text))
  }

  /** Decodes a last line that never got its newline (call at end of stream). */
  flush(): T[] {
    return this.parse(this.lines.flush())
  }

  private parse(lines: string[]): T[] {
    const out: T[] = []

    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as T)
      } catch (err) {
        this.onError?.(line, err)
      }
    }

    return out
  }
}

export function isEvent(msg: ServerMessage): msg is EventMessage {
  return typeof (msg as EventMessage).event === 'string'
}

// ---- Claude Code payloads -------------------------------------------------
// Shapes que receives from Claude Code: hook JSON on stdin and the final
// stream-json `result` line of a headless run.

export interface HookEvent {
  hook_event_name: HookEventName
  session_id: string
  cwd: string
  transcript_path: string
  permission_mode?: string
  /** Set when the event comes from a subagent rather than the main session. */
  agent_id?: string
  agent_type?: string
  /** SessionStart */
  source?: 'startup' | 'resume' | 'clear' | 'compact'
  /** UserPromptSubmit */
  prompt?: string
  prompt_id?: string
  /** PreToolUse / PostToolUse */
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_response?: unknown
  tool_use_id?: string
  /** Notification */
  notification_type?: string
  message?: string
  title?: string
  /** Stop */
  last_assistant_message?: string
  stop_hook_active?: boolean
  /** StopFailure */
  error?: string
  error_details?: string
  /** SessionEnd */
  reason?: string
}

// A type alias (not an interface) so it is assignable to a generic stream message.
export type StreamResult = {
  type: 'result'
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd'
  is_error: boolean
  num_turns: number
  total_cost_usd: number
  duration_ms: number
  session_id: string
  stop_reason: string | null
  result?: string
  /** Set on error_during_execution when the session could not start (e.g. worktree refused). */
  startup_failure_reason?: string
}
