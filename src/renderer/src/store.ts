// The renderer's single store: loads projects, workspaces, terminals, and
// tasks at boot, applies every daemon event, and holds the UI's selection. Components read it with useQue() and call its actions; nothing
// else talks to window.que except Terminal.tsx's attach/detach.
import { createContext, useContext, useSyncExternalStore } from 'react'
import type {
  ConfigGetResult,
  ConfigSetParams,
  DaemonState,
  InstructionsGetResult,
  PrThread,
  Project,
  QueApi,
  QuietState,
  QuietUnlock,
  Report,
  Task,
  TermInfo,
  Ticket,
  TicketsSyncState,
  UpdateInfo,
  Workspace,
  WorkspaceDiff,
  WorkspaceFile,
  WorkspaceFiles
} from '../../preload/index.d'
import type { SidebarSort } from './sidebar-order'
import {
  clampRatio,
  isRemembered,
  NO_SPLIT,
  type PaneLayout,
  parseLayout,
  placeIn,
  RATIO_DEFAULT,
  reconcileLayout,
  diffId,
  fileId,
  filePathOf,
  isViewId
} from './layout'
import { buildTree, newlyChanged } from './files'
import { isLiveTask, latestTasks } from './format'
import { chime, shouldChime } from './sound'
import { errorCode, errorMessage } from '../../shared/errors.decode'
import { decodeDiffBases, decodeReview, readStored, writeStored } from './persisted.decode'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/** The loose terminals (not in any workspace) share this key. */
export const SCRATCH = ''

export interface TermTab {
  id: string
  name: string
  cwd: string
  alive: boolean
  /** Was already running in the daemon when this app instance launched. */
  reattached: boolean
  /** Workspace id, or SCRATCH. */
  key: string
  createdAt: string
}

export {
  diffId,
  diffPathOf,
  fileId,
  filePathOf,
  isViewId,
  RATIO_DEFAULT,
  RATIO_MAX,
  RATIO_MIN
} from './layout'

export type { PaneLayout } from './layout'

const LAYOUT_PREFIX = 'que.layout.'

/** The review pane's tabs. */
export type ReviewTab = 'changes' | 'files' | 'pr'

const REVIEW_TABS: readonly ReviewTab[] = ['changes', 'files', 'pr']

/** The review pane at the right of the main area; one for the app, remembered. */
export interface ReviewState {
  open: boolean
  tab: ReviewTab
  width: number
}

export const REVIEW_MIN = 240
export const REVIEW_MAX = 520
export const REVIEW_DEFAULT = 320
const REVIEW_KEY = 'que.review'

export function clampReviewWidth(w: number): number {
  const n = Number.isFinite(w) ? w : REVIEW_DEFAULT

  return Math.min(REVIEW_MAX, Math.max(REVIEW_MIN, Math.round(n)))
}

/** The remembered review pane, or the defaults (closed, on Changes, 320px) for anything unreadable. */
function loadReview(): ReviewState {
  const fallback: ReviewState = { open: false, tab: 'changes', width: REVIEW_DEFAULT }

  return readStored(
    REVIEW_KEY,
    (raw) => {
      const v = decodeReview(JSON.parse(raw))

      if (!v) return fallback

      return {
        open: v.open,
        tab: REVIEW_TABS.find((t) => t === v.tab) ?? 'changes',
        width: v.width === null ? REVIEW_DEFAULT : clampReviewWidth(v.width)
      }
    },
    fallback
  )
}

/** What a workspace's diff is narrowed to: the ref it compares against, and one commit. Null: the daemon's choice, every commit. */
export interface DiffScope {
  base: string | null
  commit: string | null
}

const NO_SCOPE: DiffScope = { base: null, commit: null }
const DIFF_BASES_KEY = 'que.diffBases'

/** The remembered base per workspace id; anything unreadable is dropped. */
function loadDiffBases(): Record<string, string> {
  return readStored(DIFF_BASES_KEY, (raw) => decodeDiffBases(JSON.parse(raw)), {})
}

/** Remembers (or, for null, forgets) a workspace's base across launches. */
function rememberDiffBase(id: string, base: string | null): void {
  const bases = loadDiffBases()

  if (base === null) delete bases[id]
  else bases[id] = base

  writeStored(DIFF_BASES_KEY, Object.keys(bases).length > 0 ? JSON.stringify(bases) : null)
}

function initialDiffScopes(): Record<string, DiffScope> {
  return Object.fromEntries(
    Object.entries(loadDiffBases()).map(([id, base]) => [id, { base, commit: null }])
  )
}

export type View =
  | { kind: 'terminals'; key: string }
  | { kind: 'report' }
  | { kind: 'tickets' }
  | { kind: 'settings' }

export type DialogState =
  | { kind: 'new-workspace'; projectId: string }
  | { kind: 'remove-project'; projectId: string }
  | { kind: 'create-pr'; workspaceId: string }
  | { kind: 'remove-workspace'; workspaceId: string }
  | { kind: 'rename-workspace'; workspaceId: string }
  | { kind: 'start-ticket'; key: string; projects: Project[] }

/** A fetched value as it last landed, and why the last fetch failed (null: it did not). */
export interface Resource<T> {
  /** Absent until a fetch lands (and again after a failure drops it). */
  data?: T
  error: string | null
}

/** What the store fetches per key and keeps as a Resource. */
interface Resources {
  /** Per workspace: its pull request's conversation (null: no pull request). A failure keeps the last one. */
  prThreads: PrThread | null
  /** Per workspace: its diff against its base, in its scope. */
  diffs: WorkspaceDiff
  /** Per workspace: its worktree's files as listed. */
  fileLists: WorkspaceFiles
  /** Per fileKey(workspace, path): a file as read for its file tab; null when the path is gone. */
  fileContents: WorkspaceFile | null
}

type ResourceName = keyof Resources

type ResourceTables = { [K in ResourceName]: Record<string, Resource<Resources[K]>> }

/** The fileContents key of one file of a workspace. */
export function fileKey(key: string, path: string): string {
  return `${key}\0${path}`
}

export interface QueState extends ResourceTables {
  loaded: boolean
  connected: boolean
  /** Disconnected and asking the main process to reconnect (see the reconnect contract). */
  reconnecting: boolean
  /** Bumped on every reconnect, so the panes attach their terminals again. */
  connection: number
  /** The daemon's build as the main process last saw it; null until asked. */
  daemon: DaemonState | null
  error: string | null
  projects: Project[]
  /** Unarchived workspaces by id. */
  workspaces: Record<string, Workspace>
  terminals: TermTab[]
  tasks: Record<string, Task>
  /** The tickets assigned to the user, as last synced, in the daemon's order. */
  tickets: Ticket[]
  ticketsSync: TicketsSyncState
  view: View
  /** The pane layout per terminal key; a key without one has a single pane. */
  layouts: Record<string, PaneLayout>
  /** Per workspace: the base and commit its diff is narrowed to (none: the daemon's base, every commit). The base is remembered. */
  diffScopes: Record<string, DiffScope>
  /** Per workspace: the Files tree's open directories, for the session; none until its files first load. */
  filesExpanded: Record<string, ReadonlySet<string>>
  /** The review pane: open or not, on which tab, how wide. Remembered. */
  review: ReviewState
  dialog: DialogState | null
  /** The daemon's quiet-hours state; null until loaded. */
  quiet: QuietState | null
  /** The user config (config.get); null until loaded. */
  config: ConfigGetResult | null
  /** The sidebar filter text; empty shows everything. Not remembered. */
  filter: string
  /** Whether the sidebar search field is shown. */
  searchOpen: boolean
  /** Bumped each time the search is asked for, so the field focuses and selects again. */
  searchFocusNonce: number
  /** How projects and workspaces are ordered; remembered. */
  sort: SidebarSort
}

export interface StoreOptions {
  /** The quiet board window: never opens terminals, never chimes. */
  board?: boolean
  /** The clock for ages, countdowns and windows. Default Date.now. */
  now?: () => number
  /**
   * The workspace popout's delays in ms: how long the pointer rests on a row before it opens,
   * and how long after the pointer leaves the row and the card it closes. Default 500 and 150.
   */
  popoutDelays?: PopoutDelays
}

export interface PopoutDelays {
  open: number
  close: number
}

const POPOUT_DELAYS: PopoutDelays = { open: 500, close: 150 }

const SORT_KEY = 'que.sidebarSort'

function loadSort(): SidebarSort {
  return readStored(SORT_KEY, (raw) => (raw === 'activity' ? 'activity' : 'name'), 'name')
}

function toTab(t: TermInfo, reattached: boolean): TermTab {
  return {
    id: t.id,
    name: t.name,
    cwd: t.cwd,
    alive: t.alive,
    reattached,
    key: t.workspaceId ?? SCRATCH,
    createdAt: t.createdAt
  }
}

function byId<T extends { id: string }>(items: readonly T[]): Record<string, T> {
  return Object.fromEntries(items.map((i) => [i.id, i]))
}

function without<T>(rec: Record<string, T>, id: string): Record<string, T> {
  const { [id]: _gone, ...rest } = rec

  return rest
}

export class QueStore {
  private state: QueState = {
    loaded: false,
    connected: true,
    reconnecting: false,
    connection: 0,
    daemon: null,
    error: null,
    projects: [],
    workspaces: {},
    terminals: [],
    tasks: {},
    tickets: [],
    ticketsSync: { lastSyncAt: null, error: null, count: 0 },
    view: { kind: 'terminals', key: SCRATCH },
    layouts: {},
    prThreads: {},
    diffs: {},
    diffScopes: initialDiffScopes(),
    fileLists: {},
    fileContents: {},
    filesExpanded: {},
    review: loadReview(),
    dialog: null,
    quiet: null,
    config: null,
    filter: '',
    searchOpen: false,
    searchFocusNonce: 0,
    sort: loadSort()
  }
  private listeners = new Set<() => void>()
  private offs: Array<() => void> = []
  private boot: Promise<void> | null = null
  /** Terminal keys that already had their first-visit terminal opened. */
  private autoOpened = new Set<string>()
  /**
   * Terminals this store is creating. The daemon announces them to this window too, and that event can beat the
   * creator's reply; a tab added before the creator has placed the terminal in a pane would mount in the wrong one.
   */
  private creating = 0
  /** Announcements that arrived while `creating` was above zero, added once it drops back. */
  private createdMeanwhile: TermInfo[] = []
  /** Fetches in flight per resource and key, so a pane and a list asking at once share one request. */
  private loads = new Map<string, Promise<void>>()
  /** The latest fetch per resource and key, for those where an older answer is dropped. */
  private loadSeq = new Map<string, number>()
  /** Workspaces whose worktree change is being followed, and those with another change waiting. */
  private following = new Set<string>()
  /** The workspace this store asked the daemon to watch, if any. */
  private watchedKey: string | null = null
  private followAgain = new Set<string>()

  constructor(
    private api: QueApi,
    private options: StoreOptions = {}
  ) {}

  // ---- external store plumbing ----------------------------------------------

  getState = (): QueState => this.state

  /** The current time, from the injected clock. */
  now = (): number => (this.options.now ?? Date.now)()

  /** The workspace popout's open and close delays, injectable like the clock. */
  popoutDelays = (): PopoutDelays => this.options.popoutDelays ?? POPOUT_DELAYS

  private home: Promise<string> | null = null

  /** The user's home directory (asked once), so paths can read `~/…`. */
  homedir = (): Promise<string> => (this.home ??= this.api.app.homedir())

  // ---- app update ----------------------------------------------------------

  /** A newer release, if the main process's daily check found one. */
  fetchUpdate = (): Promise<UpdateInfo | null> => this.api.app.update()

  onUpdate = (cb: (info: UpdateInfo) => void): (() => void) => this.api.app.onUpdate(cb)

  /** Opens the newer release's page in the browser. */
  openUpdate = (): void => {
    void this.api.app.openUpdate().catch(() => {})
  }

  // ---- the daemon's build and the connection --------------------------------
  //
  // The reconnect contract (session resume and the upgrade handoff build on it):
  // - The connection drops (term.onDisconnect): `connected` goes false, the window
  //   says it is reconnecting, and the store asks the main process for the daemon's
  //   state, which reconnects or starts a daemon. A failure goes to the error line
  //   and the next try is the user's (Reconnect), never a loop.
  // - The connection is back (daemon.onReconnected, or that state call answering):
  //   everything is loaded again, the terminals that still exist attach again (the
  //   `connection` count remounts the panes), the rest are marked exited, the shown
  //   workspace is watched again (watches are per connection), a visited workspace
  //   opens a fresh shell again (autoOpened is cleared), and `daemon` is refreshed
  //   so the stale-build banner clears.

  /** Asks the main process which build the daemon runs; failures leave it unknown. */
  private refreshDaemon(): void {
    void this.api.daemon.state().then(
      (daemon) => this.set({ daemon }),
      () => {}
    )
  }

  /** Asks the main process to reconnect; once it answers, the store recovers. */
  reconnect = (): void => {
    if (this.state.connected || this.state.reconnecting) return
    this.set({ reconnecting: true })
    this.api.daemon.state().then(
      (daemon) => void this.recover(daemon),
      (err) => this.set({ reconnecting: false, error: errorMessage(err) })
    )
  }

  /** The connection is back: reload and re-attach as the contract above says. */
  private async recover(daemon: DaemonState): Promise<void> {
    this.set({ daemon })

    if (this.state.connected) return
    this.autoOpened.clear()
    // The daemon forgot this window's watch with the old connection.
    this.watchedKey = null
    this.setWith((s) => ({
      connected: true,
      reconnecting: false,
      error: null,
      connection: s.connection + 1
    }))
    this.watchShown()
    await this.load(true)
  }

  /**
   * Restarts the daemon from this app's build, ending every terminal. Only the
   * banner's button calls it. Resolves false when it failed (the error line says why).
   */
  async restartDaemon(): Promise<boolean> {
    try {
      const daemon = await this.api.daemon.restart()
      await this.recover(daemon)

      return true
    } catch (err) {
      this.set({ error: errorMessage(err) })

      return false
    }
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)

    return () => this.listeners.delete(cb)
  }

  /** Applies a patch computed from the current state. */
  /** Quiet hours are on and no unlock is running; false until the state has loaded. */
  private locked(): boolean {
    return this.state.quiet?.locked ?? false
  }

  private setWith(update: (s: QueState) => Partial<QueState>): void {
    this.set(update(this.state))
  }

  private set(patch: Partial<QueState>): void {
    const keys = Object.keys(patch) as Array<keyof QueState>

    // Nothing changed (an empty patch, or every value the same): nothing to tell.
    if (keys.every((k) => Object.is(patch[k], this.state[k]))) return
    this.state = { ...this.state, ...patch }

    if (patch.view) this.watchShown()

    for (const cb of this.listeners) cb()
  }

  /**
   * Asks the daemon to watch the worktree of the workspace this window shows, and no other, so
   * `workspace.changed` names it whatever the pane shows (a terminal, a diff, a file). Failures
   * are dropped: the Refresh button still works without the watch.
   */
  private watchShown(): void {
    const key = this.currentKey()
    const want = key !== null && key !== SCRATCH && !this.options.board ? key : null

    if (want === this.watchedKey) return
    const was = this.watchedKey
    this.watchedKey = want

    if (was !== null) void this.api.workspace.unwatch({ id: was }).catch(() => {})

    if (want !== null) void this.api.workspace.watch({ id: want }).catch(() => {})
  }

  // ---- lifecycle ------------------------------------------------------------

  /** Subscribes to daemon events and loads everything once. Safe to call again after stop(). */
  start(): void {
    this.subscribeEvents()

    if (!this.boot) {
      this.boot = this.load()

      if (!this.options.board) this.refreshDaemon()
    }
  }

  stop(): void {
    for (const off of this.offs) off()
    this.offs = []
  }

  /**
   * Loads everything. On a reconnect (`again`) the daemon's answer wins over what the
   * store holds, and a tab whose terminal the daemon no longer has is marked exited.
   */
  private async load(again = false): Promise<void> {
    try {
      const [projects, workspaces, terms, tasks, quiet, config, tickets] = await Promise.all([
        this.api.project.list(),
        this.api.workspace.list(),
        this.api.term.list(),
        this.api.task.list(),
        this.api.quiet.state(),
        this.api.config.get(),
        this.api.tickets.list()
      ])

      const live = terms.filter((t) => t.alive)
      const liveTabs = live.map((t) => toTab(t, true))

      if (again) {
        const alive = new Set(live.map((t) => t.id))
        this.setWith((s) => ({
          loaded: true,
          quiet,
          config,
          tickets: tickets.tickets,
          ticketsSync: tickets.sync,
          projects,
          workspaces: byId(workspaces),
          tasks: byId(tasks),
          terminals: mergeById(
            liveTabs,
            s.terminals.map((t) => (alive.has(t.id) ? t : { ...t, alive: false }))
          )
        }))
      } else {
        this.setWith((s) => ({
          loaded: true,
          quiet: s.quiet ?? quiet,
          config: s.config ?? config,
          tickets: tickets.tickets,
          ticketsSync: tickets.sync,
          projects: mergeById(projects, s.projects),
          workspaces: { ...byId(workspaces), ...s.workspaces },
          tasks: { ...byId(tasks), ...s.tasks },
          terminals: mergeById(liveTabs, s.terminals)
        }))
        this.hydrateLayouts()
      }

      await this.visit(this.currentKey())
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
  }

  private subscribeEvents(): void {
    if (this.offs.length > 0) return
    const { term, workspace, task, project, quiet, config, tickets } = this.api
    this.offs.push(
      quiet.on('quiet.changed', (q) => {
        const was = this.locked()
        this.set({ quiet: q })

        // Unlocked (or morning): open the current view's first terminal if it has none.
        if (was && !q.locked) void this.visit(this.currentKey())
      }),
      config.on('config.changed', (c) => this.set({ config: c })),
      tickets.on('tickets.synced', (r) => this.set({ tickets: r.tickets, ticketsSync: r.sync })),
      project.on('project.added', (p) =>
        this.setWith((s) => ({ projects: mergeById(s.projects, [p]) }))
      ),
      project.on('project.removed', ({ id }) => this.setWith((s) => dropProject(s, id))),
      term.on('term.created', (info) => {
        if (this.creating > 0) this.createdMeanwhile.push(info)
        else this.addTab(info)
      }),
      term.on('term.killed', ({ id }) => this.removeTab(id)),
      term.on('term.exit', ({ id }) =>
        this.setWith((s) => ({
          terminals: s.terminals.map((t) => (t.id === id ? { ...t, alive: false } : t))
        }))
      ),
      term.onDisconnect(() => {
        this.set({ connected: false })
        this.reconnect()
      }),
      this.api.daemon.onReconnected((daemon) => void this.recover(daemon)),
      workspace.on('workspace.created', (ws) => this.upsertWorkspace(ws)),
      workspace.on('workspace.updated', (ws) => {
        const prev = this.state.workspaces[ws.id]?.status
        this.upsertWorkspace(ws)
        // A live task's workspace never chimes on its own: its session ends a turn before the
        // task finishes, and asks for input as the task does; the task's own status chimes.
        const owned = latestTasks(this.state.tasks).get(ws.id)

        if (owned && isLiveTask(owned.state)) return

        if (prev !== ws.status) {
          this.maybeChime({ state: ws.status, reason: ws.statusReason, prev })
        }
      }),
      workspace.on('workspace.changed', ({ id }) => this.followChange(id)),
      workspace.on('workspace.removed', ({ id }) => {
        if (id in this.state.diffScopes) rememberDiffBase(id, null)
        this.setWith((s) => ({
          workspaces: without(s.workspaces, id),
          diffScopes: without(s.diffScopes, id),
          view: viewWithout(s.view, [id])
        }))
      }),
      task.on('task.created', (t) => this.upsertTask(t)),
      task.on('task.updated', (t) => {
        const prev = this.state.tasks[t.id]
        this.upsertTask(t)

        if (prev?.state !== t.state || prev?.reason !== t.reason) {
          this.maybeChime({ state: t.state, reason: t.reason })
        }
      }),
      task.on('task.removed', ({ id }) => this.setWith((s) => ({ tasks: without(s.tasks, id) })))
    )
  }

  /** A short chime for a finished task or turn (or one needing input), in work hours only. */
  private maybeChime(event: { state: string; reason?: string | null; prev?: string | null }): void {
    if (this.options.board) return
    const kind = shouldChime(event, this.state.quiet, this.state.config?.config.notifications)

    if (kind) chime(kind)
  }

  private upsertTask(t: Task): void {
    this.setWith((s) => ({ tasks: { ...s.tasks, [t.id]: t } }))
  }

  private upsertWorkspace(ws: Workspace): void {
    const prev = this.state.workspaces[ws.id]?.pr ?? null
    this.setWith((s) => ({ workspaces: { ...s.workspaces, [ws.id]: ws } }))
    // The review pane open on Pull request follows the shown workspace's pull request:
    // fetch again when it appears, disappears, or changes upstream.
    const next = ws.pr ?? null

    const changed =
      (prev === null) !== (next === null) ||
      (prev !== null && next !== null && prev.updatedAt !== next.updatedAt)

    const { review } = this.state

    if (changed && review.open && review.tab === 'pr' && this.currentKey() === ws.id) {
      void this.fetchPrThread(ws.id)
    } else if (changed && this.state.prThreads[ws.id]?.data !== undefined) {
      // Not on screen: forget the stale conversation so the next look fetches it.
      this.setWith((s) => ({
        prThreads: { ...s.prThreads, [ws.id]: { error: s.prThreads[ws.id]?.error ?? null } }
      }))
    }

    if (!this.state.projects.some((p) => p.id === ws.projectId)) {
      // A project.added that raced the workspace event; fetch the list.
      void this.api.project.list().then(
        (projects) => this.set({ projects }),
        () => {}
      )
    }
  }

  /** Adds the tab for a terminal the daemon reported, unless it already has one (the reply and the event both bring it). */
  private addTab(info: TermInfo): void {
    if (this.state.terminals.some((t) => t.id === info.id)) return
    const tab = toTab(info, false)
    this.setWith((s) => ({ terminals: mergeById(s.terminals, [tab]) }))
  }

  private currentKey(): string | null {
    return this.state.view.kind === 'terminals' ? this.state.view.key : null
  }

  /** Opens the first terminal of a key that has none, once per key. */
  private async visit(key: string | null): Promise<void> {
    if (key === null || !this.state.loaded || this.autoOpened.has(key)) return

    // The board never opens terminals; during quiet hours nothing may.
    if (this.options.board || this.locked()) return
    this.autoOpened.add(key)

    if (this.state.terminals.some((t) => t.key === key && t.alive)) return
    await this.newTerminal(key)
  }

  /** Runs an action; a failure goes to the error banner. */
  private async guard(action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch (err) {
      this.set({ error: errorMessage(err) })
    }
  }

  // ---- actions --------------------------------------------------------------

  dismissError(): void {
    this.set({ error: null })
  }

  setFilter(text: string): void {
    this.set({ filter: text })
  }

  openSearch(): void {
    this.set({ searchOpen: true, searchFocusNonce: this.state.searchFocusNonce + 1 })
  }

  closeSearch(): void {
    this.set({ searchOpen: false, filter: '' })
  }

  setSort(sort: SidebarSort): void {
    writeStored(SORT_KEY, sort)
    this.set({ sort })
  }

  openDialog(dialog: DialogState): void {
    this.set({ dialog })
  }

  closeDialog(): void {
    this.set({ dialog: null })
  }

  /**
   * Shows a workspace's terminals. The daemon only watches the shown workspace's worktree (the
   * view change asks it to, in watchShown), so what the pane and the view tabs show for the new
   * one is fetched again rather than served from the cache, in case it changed while another
   * was shown.
   */
  showTerminals(key: string): void {
    const was = this.currentKey()
    this.set({ view: { kind: 'terminals', key } })
    void this.visit(key)

    if (key !== was && key !== SCRATCH) void this.refetchShown(key)
  }

  // ---- the review pane ------------------------------------------------------

  private setReview(patch: Partial<ReviewState>): void {
    const review = { ...this.state.review, ...patch }
    this.set({ review })
    writeStored(REVIEW_KEY, JSON.stringify(review))
  }

  /** Opens the review pane on a tab and loads what it shows for the current workspace. */
  openReview(tab: ReviewTab): void {
    this.setReview({ open: true, tab })
    const key = this.currentKey()

    if (key === null || key === SCRATCH) return

    if (tab === 'changes') void this.ensureDiff(key)
    else if (tab === 'files') {
      void this.ensureFiles(key)
      void this.ensureDiff(key)
    } else void this.fetchPrThread(key)
  }

  /**
   * With no tab, closes the pane when it is open, else opens it on its remembered tab.
   * With a tab, closes the pane when it is open on that tab, else opens it there.
   */
  toggleReview(tab?: ReviewTab): void {
    const { open, tab: current } = this.state.review

    if (open && (tab === undefined || current === tab)) this.closeReview()
    else this.openReview(tab ?? current)
  }

  closeReview(): void {
    this.setReview({ open: false })
  }

  /**
   * The daemon saw the worktree change on disk. For the shown workspace, fetch again what is on
   * screen: the diff (in its scope) while the pane or a view tab is open, and the listing and the
   * open file tabs too while Files or a file tab is; nothing while quiet hours are locked, when
   * those fetches are refused. One change at a time: a change arriving
   * while one is followed is followed once more after it lands.
   */
  private followChange(id: string): void {
    if (id !== this.currentKey() || this.locked()) return

    if (this.following.has(id)) {
      this.followAgain.add(id)

      return
    }

    this.following.add(id)
    void this.refetchShown(id).finally(() => {
      this.following.delete(id)

      if (this.followAgain.delete(id)) this.followChange(id)
    })
  }

  private refetchShown(key: string): Promise<void> {
    const { open, tab } = this.state.review
    const views = this.layout(key).views
    const fileTabs = views.some((v) => filePathOf(v) !== null)

    if (!open && views.length === 0) return Promise.resolve()
    const loads = [this.fetchDiff(key)]

    if ((open && tab === 'files') || fileTabs) loads.push(this.reloadFiles(key))

    return Promise.all(loads).then(() => undefined)
  }

  setReviewTab(tab: ReviewTab): void {
    this.setReview({ tab })
  }

  setReviewWidth(px: number): void {
    this.setReview({ width: clampReviewWidth(px) })
  }

  // ---- diff tabs ------------------------------------------------------------

  /** Opens a file's diff tab and selects it: where it already is, or else in the focused pane. */
  openDiff(key: string, path: string): void {
    this.openView(key, diffId(path))
  }

  /** Opens a worktree file's read-only tab and selects it: where it already is, or else in the focused pane. */
  openFile(key: string, path: string): void {
    this.openView(key, fileId(path))
  }

  private openView(key: string, id: string): void {
    const l = this.layout(key)

    if (l.views.includes(id)) {
      this.selectTerminal(key, id)

      return
    }

    this.setLayout(key, {
      ...placeIn(l, this.focusedPane(key), id, { append: true }),
      views: [...l.views, id]
    })
  }

  /** Closes a view tab; its pane selects the neighbouring tab, and an emptied split collapses. */
  closeView(key: string, id: string): void {
    const l = this.layout(key)

    if (!l.views.includes(id)) return
    const pane = l.second.includes(id) ? 1 : 0
    const ids = this.paneIds(key, pane)
    const at = ids.indexOf(id)
    const neighbour = ids[at - 1] ?? ids[at + 1] ?? null
    const active: PaneLayout['active'] = [...l.active]

    if (this.paneActiveId(key, pane) === id) active[pane] = neighbour

    const next: PaneLayout = {
      ...l,
      views: l.views.filter((v) => v !== id),
      second: l.second.filter((x) => x !== id),
      active
    }

    const tabIds = this.tabs(key).map((t) => t.id)
    this.setLayout(key, reconcileLayout(next, new Set(tabIds), tabIds))
  }

  /** Closes the focused pane's active tab: a view tab (a diff or a file), or a terminal (which is killed). */
  closeActiveTab(key: string): void {
    const id = this.paneActiveId(key, this.focusedPane(key))

    if (id && isViewId(id)) this.closeView(key, id)
    else if (id) void this.closeTerminal(id)
  }

  /**
   * Fetches one key of a resource and keeps the answer, or why it failed: with `keepOnError` the
   * last value stays beside the error, else it is dropped. With `latestOnly`, only the latest
   * fetch per key lands, so a quick change of scope never shows a stale answer; the fetcher gets
   * the check, for side effects of its own. `onData` adds to the patch that keeps a value.
   */
  private fetchInto<K extends ResourceName>(
    name: K,
    key: string,
    fetcher: (current: () => boolean) => Promise<Resources[K]>,
    opts: {
      latestOnly: boolean
      keepOnError: boolean
      onData?: (s: QueState, data: Resources[K]) => Partial<QueState>
    }
  ): Promise<void> {
    const slot = `${name}\0${key}`
    const seq = (this.loadSeq.get(slot) ?? 0) + 1

    if (opts.latestOnly) this.loadSeq.set(slot, seq)
    const current = (): boolean => !opts.latestOnly || this.loadSeq.get(slot) === seq

    const load = (async () => {
      try {
        const data = await fetcher(current)

        if (!current()) return
        this.setWith((s) => ({
          ...withEntry(s, name, key, { data, error: null }),
          ...opts.onData?.(s, data)
        }))
      } catch (err) {
        if (!current()) return
        const error = errorMessage(err)

        this.setWith((s) =>
          withEntry(s, name, key, opts.keepOnError ? { ...s[name][key], error } : { error })
        )
      }
    })()

    this.loads.set(slot, load)
    void load.finally(() => {
      if (this.loads.get(slot) === load) this.loads.delete(slot)
    })

    return load
  }

  /** Fetches one key of a resource unless it is loaded or on its way. */
  private ensure(name: ResourceName, key: string, fetch: () => Promise<void>): Promise<void> {
    if (this.state[name][key]?.data !== undefined) return Promise.resolve()

    return this.loads.get(`${name}\0${key}`) ?? fetch()
  }

  /** Fetches a workspace's pull request conversation; a failure (quiet hours too) is kept for the view. */
  fetchPrThread(key: string, refresh = false): Promise<void> {
    return this.fetchInto(
      'prThreads',
      key,
      () => this.api.workspace.prThread(refresh ? { id: key, refresh: true } : { id: key }),
      { latestOnly: false, keepOnError: true }
    )
  }

  /** Fetches the conversation unless it is loaded or on its way. */
  ensurePrThread(key: string): Promise<void> {
    return this.ensure('prThreads', key, () => this.fetchPrThread(key))
  }

  /** The base and commit a workspace's diff is narrowed to. */
  diffScope(key: string): DiffScope {
    return this.state.diffScopes[key] ?? NO_SCOPE
  }

  /**
   * Fetches a workspace's diff in its scope; a failure (quiet hours too) is kept for the views.
   * A base the daemon reports as rejected (a branch since deleted) is forgotten; the diff is then against its default.
   * Only the latest fetch per workspace lands, so a quick change of scope never shows a stale answer.
   */
  fetchDiff(key: string): Promise<void> {
    return this.fetchInto(
      'diffs',
      key,
      async (current) => {
        const scope = this.diffScope(key)

        const diff = await this.api.workspace.diff({
          id: key,
          base: scope.base ?? undefined,
          commit: scope.commit ?? undefined
        })

        if (diff.rejectedBase !== null && current()) {
          rememberDiffBase(key, null)
          this.setWith((s) => ({
            diffScopes: { ...s.diffScopes, [key]: { ...scope, base: null } }
          }))
        }

        return diff
      },
      { latestOnly: true, keepOnError: false, onData: (s, diff) => openNewlyChanged(s, key, diff) }
    )
  }

  /** Compares a workspace against another ref (null: the daemon's choice), over every commit; remembered per workspace. */
  setDiffBase(key: string, base: string | null): Promise<void> {
    rememberDiffBase(key, base)
    this.setWith((s) => ({ diffScopes: { ...s.diffScopes, [key]: { base, commit: null } } }))

    return this.fetchDiff(key)
  }

  /** Narrows a workspace's diff to one commit's own changes (null: every commit). Not remembered. */
  setDiffCommit(key: string, commit: string | null): Promise<void> {
    this.setWith((s) => ({
      diffScopes: { ...s.diffScopes, [key]: { ...(s.diffScopes[key] ?? NO_SCOPE), commit } }
    }))

    return this.fetchDiff(key)
  }

  /** Fetches the diff unless it is loaded or on its way. */
  ensureDiff(key: string): Promise<void> {
    return this.ensure('diffs', key, () => this.fetchDiff(key))
  }

  // ---- the Files tab and file tabs -------------------------------------------

  /**
   * Lists a workspace's files; a failure (quiet hours too) is kept for the tree.
   * Only the latest listing per workspace lands.
   */
  fetchFiles(key: string): Promise<void> {
    return this.fetchInto('fileLists', key, () => this.api.workspace.files({ id: key }), {
      latestOnly: true,
      keepOnError: false
    })
  }

  /** Lists the files unless they are listed or on their way. */
  ensureFiles(key: string): Promise<void> {
    return this.ensure('fileLists', key, () => this.fetchFiles(key))
  }

  /** Reads one file for its tab; a path that is gone is kept as null, any other failure as an error. */
  fetchFile(key: string, path: string): Promise<void> {
    return this.fetchInto(
      'fileContents',
      fileKey(key, path),
      async () => {
        try {
          return await this.api.workspace.readFile({ id: key, path })
        } catch (err) {
          // The daemon's not-found code: the path left the worktree.
          if (errorCode(err) === 'not_found') return null
          throw err
        }
      },
      { latestOnly: false, keepOnError: false }
    )
  }

  /** Reads the file unless it is read or on its way. */
  ensureFile(key: string, path: string): Promise<void> {
    return this.ensure('fileContents', fileKey(key, path), () => this.fetchFile(key, path))
  }

  /** The Files header's Refresh: the listing, the diff, and every open file tab of the workspace. */
  refreshFiles(key: string): Promise<void> {
    return Promise.all([this.reloadFiles(key), this.fetchDiff(key)]).then(() => undefined)
  }

  /** The listing and every open file tab of a workspace, without the diff. */
  private reloadFiles(key: string): Promise<void> {
    const paths = this.layout(key)
      .views.map(filePathOf)
      .filter((p): p is string => p !== null)

    return Promise.all([this.fetchFiles(key), ...paths.map((p) => this.fetchFile(key, p))]).then(
      () => undefined
    )
  }

  /** Sets the Files tree's open directories for a workspace. */
  setFilesExpanded(key: string, expanded: ReadonlySet<string>): void {
    this.setWith((s) => ({ filesExpanded: { ...s.filesExpanded, [key]: expanded } }))
  }

  showReport(): void {
    this.set({ view: { kind: 'report' } })
  }

  showTickets(): void {
    this.set({ view: { kind: 'tickets' } })
  }

  showSettings(): void {
    this.set({ view: { kind: 'settings' } })
  }

  /** Syncs the tickets now; a failure goes to the error banner. */
  syncTickets(): Promise<void> {
    return this.guard(async () => {
      const r = await this.api.tickets.sync()
      this.set({ tickets: r.tickets, ticketsSync: r.sync })
    })
  }

  /**
   * Starts a ticket: a workspace in the learned (or chosen) project, or a loose
   * session. Asks which project when none is known. Throws for the dialog.
   */
  async startTicket(
    key: string,
    choice?: { projectId: string } | { session: true }
  ): Promise<void> {
    const result = await this.api.tickets.start({ key, ...choice })

    if (result.kind === 'needs_project') {
      this.openDialog({ kind: 'start-ticket', key, projects: result.projects })
    } else if (result.kind === 'workspace') {
      this.upsertWorkspace(result.workspace)
      this.showTerminals(result.workspace.id)
    } else {
      // Add the tab before the view shows, so the view does not open a second terminal.
      this.addTab(result.terminal)
      this.showTerminals(SCRATCH)
      this.selectTerminal(SCRATCH, result.terminal.id)
    }
  }

  /** The Start button: like startTicket, with a failure shown in the error banner. */
  beginTicket(key: string): Promise<void> {
    return this.guard(() => this.startTicket(key))
  }

  unlock(): Promise<void> {
    return this.guard(async () => this.set({ quiet: await this.api.quiet.unlock() }))
  }

  lock(): Promise<void> {
    return this.guard(async () => this.set({ quiet: await this.api.quiet.lock() }))
  }

  fetchUnlocks(since?: string): Promise<QuietUnlock[]> {
    return this.api.quiet.log(since ? { since } : undefined)
  }

  /** Saves config changes; throws for the settings view to show. */
  async saveConfig(p: ConfigSetParams): Promise<ConfigGetResult> {
    const config = await this.api.config.set(p)
    this.set({ config })

    return config
  }

  /** The instructions file (instructions_file): its path, whether it exists, its text. */
  loadInstructions(): Promise<InstructionsGetResult> {
    return this.api.instructions.get()
  }

  /** Writes the instructions file; rejects with `not_configured` when no path is set. */
  saveInstructions(content: string): Promise<InstructionsGetResult> {
    return this.api.instructions.set({ content })
  }

  /** Selects a tab (a terminal or a view) within the pane that holds it, and focuses that pane. */
  selectTerminal(key: string, id: string): void {
    const l = this.layout(key)
    this.setLayout(key, placeIn(l, l.second.includes(id) ? 1 : 0, id, { append: false }))
  }

  /** Focuses a pane (the second only when the key is split). */
  focusPane(key: string, pane: 0 | 1): void {
    const l = this.layout(key)

    if (l.focused === pane || (pane === 1 && !l.split)) return
    this.setLayout(key, { ...l, focused: pane })
  }

  /** The layout of a key. */
  layout(key: string): PaneLayout {
    return this.state.layouts[key] ?? NO_SPLIT
  }

  /** The terminal tabs of one pane, oldest first. */
  paneTabs(key: string, pane: 0 | 1): TermTab[] {
    const second = this.layout(key).second

    return this.tabs(key).filter((t) => second.includes(t.id) === (pane === 1))
  }

  /** The view (diff) tab ids of one pane, in the order they were opened. */
  paneViews(key: string, pane: 0 | 1): string[] {
    const l = this.layout(key)

    return l.views.filter((v) => l.second.includes(v) === (pane === 1))
  }

  /** Every tab id of one pane: its terminals, then its views. */
  private paneIds(key: string, pane: 0 | 1): string[] {
    return [...this.paneTabs(key, pane).map((t) => t.id), ...this.paneViews(key, pane)]
  }

  /** The selected tab id (a terminal or a view) of a pane, else its newest tab. */
  paneActiveId(key: string, pane: 0 | 1): string | null {
    const ids = this.paneIds(key, pane)
    const want = this.layout(key).active[pane]

    return (want && ids.includes(want) ? want : ids.at(-1)) ?? null
  }

  /** The selected terminal of a pane; null when the pane shows a view tab or holds no terminal. */
  paneActive(key: string, pane: 0 | 1): TermTab | null {
    const id = this.paneActiveId(key, pane)

    return this.paneTabs(key, pane).find((t) => t.id === id) ?? null
  }

  focusedPane(key: string): 0 | 1 {
    const l = this.layout(key)

    return l.split ? l.focused : 0
  }

  /** Creates a terminal for a key (a workspace's, or a loose one in the active tab's folder). */
  private async createFor(key: string): Promise<TermInfo> {
    if (key === SCRATCH) {
      const cwd = this.activeTab(key)?.cwd ?? (await this.homedir())

      return this.api.term.create({ cwd, cols: DEFAULT_COLS, rows: DEFAULT_ROWS })
    }

    return this.api.workspace.openTerminal({ id: key, cols: DEFAULT_COLS, rows: DEFAULT_ROWS })
  }

  /**
   * Creates a terminal and places it in a pane once its id is known, before its
   * tab appears, so it never mounts in the wrong pane (see `creating`).
   */
  private async openIn(key: string, place: (id: string) => void): Promise<void> {
    this.creating++

    try {
      const info = await this.createFor(key)
      place(info.id)
      this.addTab(info)
    } catch (err) {
      this.set({ error: errorMessage(err) })
    } finally {
      this.creating--

      if (this.creating === 0) {
        const others = this.createdMeanwhile
        this.createdMeanwhile = []

        for (const info of others) this.addTab(info)
      }
    }
  }

  /** A new terminal in the focused pane. */
  async newTerminal(key: string): Promise<void> {
    await this.openIn(key, (id) =>
      this.setLayout(key, placeIn(this.layout(key), this.focusedPane(key), id, { append: true }))
    )
  }

  /** Splits the key in two with a new terminal in the second pane (or adds one to it). */
  async splitPane(key: string, direction: 'row' | 'column'): Promise<void> {
    const first = this.paneActiveId(key, 0)
    await this.openIn(key, (id) => {
      const l = this.layout(key)
      this.setLayout(key, {
        ...l,
        split: l.split ?? { direction, ratio: RATIO_DEFAULT },
        second: [...l.second, id],
        active: [l.split ? l.active[0] : first, id],
        focused: 1
      })
    })
  }

  /** Joins the second pane's tabs onto the first; nothing is killed. */
  joinPanes(key: string): void {
    const l = this.layout(key)

    if (!l.split) return
    this.setLayout(key, {
      ...NO_SPLIT,
      views: l.views,
      active: [l.active[l.focused] ?? l.active[0], null]
    })
  }

  setRatio(key: string, ratio: number): void {
    const l = this.layout(key)

    if (!l.split) return
    this.setLayout(key, { ...l, split: { ...l.split, ratio: clampRatio(ratio) } })
  }

  private setLayout(key: string, layout: PaneLayout): void {
    this.setWith((s) => ({ layouts: { ...s.layouts, [key]: layout } }))
    writeStored(LAYOUT_PREFIX + key, isRemembered(layout) ? JSON.stringify(layout) : null)
  }

  /** Restores the remembered layouts and view tabs, dropping terminals that no longer exist. */
  private hydrateLayouts(): void {
    const layouts: Record<string, PaneLayout> = {}

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const name = localStorage.key(i)

        if (!name?.startsWith(LAYOUT_PREFIX)) continue
        const key = name.slice(LAYOUT_PREFIX.length)
        const parsed = parseLayout(localStorage.getItem(name))

        if (!parsed) continue
        const tabIds = this.tabs(key).map((t) => t.id)
        const l = reconcileLayout(parsed, new Set(tabIds), tabIds)

        if (isRemembered(l)) layouts[key] = l
      }
    } catch {
      return
    }

    this.setWith((s) => ({ layouts: { ...layouts, ...s.layouts } }))
  }

  /** Removes a tab, collapsing its key's split if a pane is left empty. */
  private removeTab(id: string): void {
    const key = this.state.terminals.find((t) => t.id === id)?.key
    const terminals = this.state.terminals.filter((t) => t.id !== id)
    this.set({ terminals })
    const l = key === undefined ? undefined : this.state.layouts[key]

    if (key === undefined || !l?.split) return
    const tabIds = terminals.filter((t) => t.key === key).map((t) => t.id)
    const next = reconcileLayout(l, new Set(tabIds), tabIds)

    if (next !== l) this.setLayout(key, next)
  }

  async closeTerminal(id: string): Promise<void> {
    this.removeTab(id)

    try {
      await this.api.term.kill({ id })
    } catch {
      // Already gone.
    }
  }

  /** The tabs of a key, oldest first. */
  tabs(key: string): TermTab[] {
    return this.state.terminals.filter((t) => t.key === key)
  }

  /** The selected terminal of the focused pane, else of the first pane. */
  activeTab(key: string): TermTab | null {
    return this.paneActive(key, this.focusedPane(key)) ?? this.paneActive(key, 0)
  }

  addProject(): Promise<void> {
    return this.guard(async () => {
      const dir = await this.api.app.openFolder()

      if (!dir) return
      const project = await this.api.project.add({ path: dir })
      this.setWith((s) => ({
        projects: s.projects.some((p) => p.id === project.id)
          ? s.projects
          : [...s.projects, project]
      }))
    })
  }

  /**
   * Creates a workspace and shows it, which opens its first terminal. With `start`, the daemon
   * opens that terminal and types claude on the start prompt into it once setup is done; its tab
   * is added before the view shows, so the view does not open a second one. Throws for the dialog.
   */
  async createWorkspace(p: {
    projectId: string
    brief: string
    /** The workspace, branch and folder name. */
    name: string
    baseRef?: string
    start?: boolean
  }): Promise<void> {
    const { start, ...params } = p
    const ws = await this.api.workspace.create(params)
    this.upsertWorkspace(ws)

    if (!start) {
      this.showTerminals(ws.id)

      return
    }

    // The workspace exists now: a failure to start goes to the banner, not back to the dialog.
    let terminal: TermInfo

    try {
      ;({ terminal } = await this.api.workspace.start({
        id: ws.id,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS
      }))
    } catch (err) {
      this.set({ error: errorMessage(err) })
      this.showTerminals(ws.id)

      return
    }

    this.addTab(terminal)
    this.showTerminals(ws.id)
    this.selectTerminal(ws.id, terminal.id)
  }

  /** Whether a rename may also rename the workspace's branch (it was never pushed). */
  async canRenameBranch(id: string): Promise<boolean> {
    return (await this.api.workspace.canRenameBranch({ id })).allowed
  }

  /**
   * Tells the daemon the workspace is selected in a focused window, so a finish it shows
   * no longer reads as new. Errors (a dropped connection, a workspace just removed) are
   * dropped: the next selection or focus asks again.
   */
  async markSeen(id: string): Promise<void> {
    try {
      this.upsertWorkspace(await this.api.workspace.seen({ id }))
    } catch {
      // nothing to show; see above
    }
  }

  /** Sets a workspace's title (and branch, when asked). Throws for the dialog. */
  async renameWorkspace(id: string, title: string, branch?: string): Promise<void> {
    const ws = await this.api.workspace.rename({ id, title, branch })

    this.upsertWorkspace(ws)
  }

  /** Removes the project and, with it, its workspaces (terminals killed, worktrees deleted). */
  async removeProject(id: string): Promise<void> {
    await this.api.project.remove({ id, force: true })
    this.setWith((s) => dropProject(s, id))
  }

  async removeWorkspace(id: string, deleteBranch: boolean): Promise<void> {
    await this.api.workspace.remove({ id, deleteBranch })
    this.setWith((s) => ({
      workspaces: without(s.workspaces, id),
      view: viewWithout(s.view, [id])
    }))
  }

  openInEditor(path: string): Promise<void> {
    return this.guard(async () => {
      await this.api.app.openInEditor({ path })
    })
  }

  async createPr(id: string, title: string): Promise<string> {
    const { prUrl } = await this.api.workspace.createPr({ id, title })
    this.setWith((s) => {
      const ws = s.workspaces[id]

      return ws ? { workspaces: { ...s.workspaces, [id]: { ...ws, prUrl } } } : {}
    })

    return prUrl
  }

  fetchReport(): Promise<Report> {
    return this.api.report.get()
  }
}

/** The state's patch that keeps one key's entry of a resource. */
function withEntry<K extends ResourceName>(
  s: QueState,
  name: K,
  key: string,
  entry: Resource<Resources[K]>
): Partial<QueState> {
  const patch: Partial<ResourceTables> = { [name]: { ...s[name], [key]: entry } }

  return patch
}

/**
 * Once the Files tree has its open directories, any directory that holds a changed file in the
 * new diff and held none before is opened; the rest of the set stands.
 */
function openNewlyChanged(s: QueState, key: string, diff: WorkspaceDiff): Partial<QueState> {
  const expanded = s.filesExpanded[key]

  if (expanded === undefined) return {}

  const tree = buildTree(
    s.fileLists[key]?.data?.files ?? [],
    new Map(diff.files.map((f) => [f.path, f]))
  )

  const opened = newlyChanged(
    (s.diffs[key]?.data?.files ?? []).map((f) => f.path),
    tree
  )

  if (opened.length === 0) return {}

  return { filesExpanded: { ...s.filesExpanded, [key]: new Set([...expanded, ...opened]) } }
}

/** Both lists in creation order, without duplicates (the first list's copy wins). */
function mergeById<T extends { id: string; createdAt: string }>(
  a: readonly T[],
  b: readonly T[]
): T[] {
  const seen = new Set(a.map((x) => x.id))

  return [...a, ...b.filter((x) => !seen.has(x.id))].sort((x, y) =>
    x.createdAt.localeCompare(y.createdAt)
  )
}

/** The view, or the scratch terminals when it shows one of these workspaces. */
function viewWithout(view: View, ids: readonly string[]): View {
  return view.kind === 'terminals' && ids.includes(view.key)
    ? { kind: 'terminals', key: SCRATCH }
    : view
}

/** The state without a project and its workspaces; a view on one of them goes back to scratch. */
function dropProject(s: QueState, id: string): Partial<QueState> {
  const gone = new Set(
    Object.values(s.workspaces)
      .filter((w) => w.projectId === id)
      .map((w) => w.id)
  )

  return {
    projects: s.projects.filter((p) => p.id !== id),
    workspaces: Object.fromEntries(Object.entries(s.workspaces).filter(([k]) => !gone.has(k))),
    view: viewWithout(s.view, [...gone])
  }
}

export const StoreContext = createContext<QueStore | null>(null)

export function useStore(): QueStore {
  const store = useContext(StoreContext)

  if (!store) throw new Error('useStore() outside <App>')

  return store
}

/** The store's state; re-renders on every change. */
export function useQue(): QueState {
  const store = useStore()

  return useSyncExternalStore(store.subscribe, store.getState)
}

/**
 * One value of the store's state; re-renders only when it changes (by Object.is). The selector
 * must return a value the state already holds (a field, an entry, a primitive), never a new
 * object or array per call.
 */
export function useQueSelector<T>(select: (s: QueState) => T): T {
  const store = useStore()

  return useSyncExternalStore(store.subscribe, () => select(store.getState()))
}

/**
 * The store, for a component that reads a key's tabs and panes through its pane methods
 * (paneTabs, paneActiveId, activeTab, …): re-renders when the terminals or the key's layout change.
 */
export function usePanes(key: string): QueStore {
  useQueSelector((s) => s.terminals)
  useQueSelector((s) => s.layouts[key])

  return useStore()
}
