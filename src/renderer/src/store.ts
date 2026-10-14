// The renderer's single store: loads projects, workspaces, terminals, and
// tasks at boot, applies every daemon event, and holds the UI's selection. Components read it with useQue() and call its actions; nothing
// else talks to window.que except Terminal.tsx's attach/detach.
import { createContext, useContext, useSyncExternalStore } from 'react'
import type {
  ConfigGetResult,
  ConfigSetParams,
  Project,
  QueApi,
  QuietState,
  QuietUnlock,
  Report,
  Task,
  TermInfo,
  UpdateInfo,
  Workspace
} from '../../preload/index.d'
import { chime, shouldChime } from './sound'

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

export type View = { kind: 'terminals'; key: string } | { kind: 'report' } | { kind: 'settings' }

export type DialogState =
  | { kind: 'new-workspace'; projectId: string }
  | { kind: 'create-pr'; workspaceId: string }
  | { kind: 'remove-workspace'; workspaceId: string }

export interface QueState {
  loaded: boolean
  connected: boolean
  error: string | null
  projects: Project[]
  /** Unarchived workspaces by id. */
  workspaces: Record<string, Workspace>
  terminals: TermTab[]
  tasks: Record<string, Task>
  view: View
  /** The selected tab per terminal key. */
  activeTerm: Record<string, string>
  dialog: DialogState | null
  /** The daemon's quiet-hours state; null until loaded. */
  quiet: QuietState | null
  /** The user config (config.get); null until loaded. */
  config: ConfigGetResult | null
}

export interface StoreOptions {
  /** The quiet board window: never opens terminals, never chimes. */
  board?: boolean
  /** The clock for ages, countdowns and windows. Default Date.now. */
  now?: () => number
}

/** Quiet hours are on and detail is not unlocked: terminals and reports are refused. */
export function isLocked(q: QuietState | null): boolean {
  return Boolean(q?.inQuietHours && !q.unlockedUntil)
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

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class QueStore {
  private state: QueState = {
    loaded: false,
    connected: true,
    error: null,
    projects: [],
    workspaces: {},
    terminals: [],
    tasks: {},
    view: { kind: 'terminals', key: SCRATCH },
    activeTerm: {},
    dialog: null,
    quiet: null,
    config: null
  }
  private listeners = new Set<() => void>()
  private offs: Array<() => void> = []
  private boot: Promise<void> | null = null
  /** Terminal keys that already had their first-visit terminal opened. */
  private autoOpened = new Set<string>()

  constructor(
    private api: QueApi,
    private options: StoreOptions = {}
  ) {}

  // ---- external store plumbing ----------------------------------------------

  getState = (): QueState => this.state

  /** The current time, from the injected clock. */
  now = (): number => (this.options.now ?? Date.now)()

  // ---- app update ----------------------------------------------------------

  /** A newer release, if the main process's daily check found one. */
  fetchUpdate = (): Promise<UpdateInfo | null> => this.api.app.update()

  onUpdate = (cb: (info: UpdateInfo) => void): (() => void) => this.api.app.onUpdate(cb)

  /** Opens the newer release's page in the browser. */
  openUpdate = (): void => {
    void this.api.app.openUpdate().catch(() => {})
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private set(update: Partial<QueState> | ((s: QueState) => Partial<QueState>)): void {
    const patch = typeof update === 'function' ? update(this.state) : update
    this.state = { ...this.state, ...patch }
    for (const cb of this.listeners) cb()
  }

  // ---- lifecycle ------------------------------------------------------------

  /** Subscribes to daemon events and loads everything once. Safe to call again after stop(). */
  start(): void {
    this.subscribeEvents()
    this.boot ??= this.load()
  }

  stop(): void {
    for (const off of this.offs) off()
    this.offs = []
  }

  private async load(): Promise<void> {
    try {
      const [projects, workspaces, terms, tasks, quiet, config] = await Promise.all([
        this.api.project.list(),
        this.api.workspace.list(),
        this.api.term.list(),
        this.api.task.list(),
        this.api.quiet.state(),
        this.api.config.get()
      ])
      const live = terms.filter((t) => t.alive)
      this.set((s) => ({
        loaded: true,
        quiet: s.quiet ?? quiet,
        config: s.config ?? config,
        projects: mergeProjects(projects, s.projects),
        workspaces: { ...byId(workspaces), ...s.workspaces },
        tasks: { ...byId(tasks), ...s.tasks },
        terminals: mergeTabs(
          live.map((t) => toTab(t, true)),
          s.terminals
        )
      }))
      await this.visit(this.currentKey())
    } catch (err) {
      this.set({ error: message(err) })
    }
  }

  private subscribeEvents(): void {
    if (this.offs.length > 0) return
    const { term, workspace, task, project, quiet, config } = this.api
    this.offs.push(
      quiet.on('quiet.changed', (q) => {
        const was = isLocked(this.state.quiet)
        this.set({ quiet: q })
        // Unlocked (or morning): open the current view's first terminal if it has none.
        if (was && !isLocked(q)) void this.visit(this.currentKey())
      }),
      config.on('config.changed', (c) => this.set({ config: c })),
      project.on('project.added', (p) =>
        this.set((s) => ({ projects: mergeProjects(s.projects, [p]) }))
      ),
      project.on('project.removed', ({ id }) =>
        this.set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }))
      ),
      term.on('term.created', ({ id }) => void this.addTerminal(id)),
      term.on('term.killed', ({ id }) =>
        this.set((s) => ({ terminals: s.terminals.filter((t) => t.id !== id) }))
      ),
      term.on('term.exit', ({ id }) =>
        this.set((s) => ({
          terminals: s.terminals.map((t) => (t.id === id ? { ...t, alive: false } : t))
        }))
      ),
      term.onDisconnect(() => this.set({ connected: false })),
      workspace.on('workspace.created', (ws) => this.upsertWorkspace(ws)),
      workspace.on('workspace.updated', (ws) => this.upsertWorkspace(ws)),
      workspace.on('workspace.removed', ({ id }) =>
        this.set((s) => ({
          workspaces: without(s.workspaces, id),
          view: s.view.kind === 'terminals' && s.view.key === id ? scratchView() : s.view
        }))
      ),
      workspace.on('workspace.status', (e) => {
        const prev = this.state.workspaces[e.id]?.status
        this.set((s) => {
          const ws = s.workspaces[e.id]
          if (!ws) return {}
          const next = { ...ws, status: e.status, statusReason: e.reason ?? null, statusAt: e.at }
          return { workspaces: { ...s.workspaces, [e.id]: next } }
        })
        if (prev !== e.status) this.maybeChime({ state: e.status, reason: e.reason })
      }),
      task.on('task.created', (t) => this.set((s) => ({ tasks: { ...s.tasks, [t.id]: t } }))),
      task.on('task.updated', (t) => this.set((s) => ({ tasks: { ...s.tasks, [t.id]: t } }))),
      task.on('task.status', (e) => {
        const prev = this.state.tasks[e.id]
        if (prev?.state !== e.state || prev?.reason !== (e.reason ?? null)) {
          this.maybeChime({ state: e.state, reason: e.reason })
        }
        this.set((s) => {
          const t = s.tasks[e.id]
          if (!t) return {}
          return {
            tasks: { ...s.tasks, [e.id]: { ...t, state: e.state, reason: e.reason ?? null } }
          }
        })
        // The status event carries no workspace, branch, or PR; re-read the task.
        void this.api.task.get({ id: e.id }).then(
          (t) => this.set((s) => ({ tasks: { ...s.tasks, [t.id]: t } })),
          () => {}
        )
      })
    )
  }

  /** A short chime for a finished task (or one needing input), in work hours only. */
  private maybeChime(event: { state: string; reason?: string | null }): void {
    if (this.options.board) return
    const kind = shouldChime(event, this.state.quiet, this.state.config?.config.notifications)
    if (kind) chime(kind)
  }

  private upsertWorkspace(ws: Workspace): void {
    this.set((s) => ({ workspaces: { ...s.workspaces, [ws.id]: ws } }))
    if (!this.state.projects.some((p) => p.id === ws.projectId)) {
      // A project.added that raced the workspace event; fetch the list.
      void this.api.project.list().then(
        (projects) => this.set({ projects }),
        () => {}
      )
    }
  }

  private async addTerminal(id: string): Promise<TermTab | null> {
    const existing = this.state.terminals.find((t) => t.id === id)
    if (existing) return existing
    const info = (await this.api.term.list()).find((t) => t.id === id)
    if (!info) return null
    const tab = toTab(info, false)
    this.set((s) => ({ terminals: mergeTabs(s.terminals, [tab]) }))
    return tab
  }

  private currentKey(): string | null {
    return this.state.view.kind === 'terminals' ? this.state.view.key : null
  }

  /** Opens the first terminal of a key that has none, once per key. */
  private async visit(key: string | null): Promise<void> {
    if (key === null || !this.state.loaded || this.autoOpened.has(key)) return
    // The board never opens terminals; during quiet hours nothing may.
    if (this.options.board || isLocked(this.state.quiet)) return
    this.autoOpened.add(key)
    if (this.state.terminals.some((t) => t.key === key && t.alive)) return
    await this.newTerminal(key)
  }

  private fail(err: unknown): void {
    this.set({ error: message(err) })
  }

  // ---- actions --------------------------------------------------------------

  dismissError(): void {
    this.set({ error: null })
  }

  openDialog(dialog: DialogState): void {
    this.set({ dialog })
  }

  closeDialog(): void {
    this.set({ dialog: null })
  }

  showTerminals(key: string): void {
    this.set({ view: { kind: 'terminals', key } })
    void this.visit(key)
  }

  showReport(): void {
    this.set({ view: { kind: 'report' } })
  }

  showSettings(): void {
    this.set({ view: { kind: 'settings' } })
  }

  async unlock(): Promise<void> {
    try {
      this.set({ quiet: await this.api.quiet.unlock() })
    } catch (err) {
      this.fail(err)
    }
  }

  async lock(): Promise<void> {
    try {
      this.set({ quiet: await this.api.quiet.lock() })
    } catch (err) {
      this.fail(err)
    }
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

  selectTerminal(key: string, id: string): void {
    this.set((s) => ({ activeTerm: { ...s.activeTerm, [key]: id } }))
  }

  /** A new terminal in a workspace, or a loose one in the active tab's folder. */
  async newTerminal(key: string): Promise<void> {
    try {
      let id: string
      if (key === SCRATCH) {
        const active = this.activeTab(key)
        const cwd = active?.cwd ?? (await this.api.app.homedir())
        ;({ id } = await this.api.term.create({ cwd, cols: DEFAULT_COLS, rows: DEFAULT_ROWS }))
      } else {
        ;({ id } = await this.api.workspace.openTerminal({
          id: key,
          cols: DEFAULT_COLS,
          rows: DEFAULT_ROWS
        }))
      }
      await this.addTerminal(id)
      this.selectTerminal(key, id)
    } catch (err) {
      this.fail(err)
    }
  }

  async closeTerminal(id: string): Promise<void> {
    this.set((s) => ({ terminals: s.terminals.filter((t) => t.id !== id) }))
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

  /** The selected tab of a key, else its newest. */
  activeTab(key: string): TermTab | null {
    const tabs = this.tabs(key)
    return tabs.find((t) => t.id === this.state.activeTerm[key]) ?? tabs.at(-1) ?? null
  }

  async addProject(): Promise<void> {
    try {
      const dir = await this.api.app.openFolder()
      if (!dir) return
      const project = await this.api.project.add({ path: dir })
      this.set((s) => ({
        projects: s.projects.some((p) => p.id === project.id)
          ? s.projects
          : [...s.projects, project]
      }))
    } catch (err) {
      this.fail(err)
    }
  }

  /** Creates a workspace and shows it (which opens its first terminal). Throws for the dialog. */
  async createWorkspace(p: { projectId: string; name: string; baseRef?: string }): Promise<void> {
    const ws = await this.api.workspace.create(p)
    this.upsertWorkspace(ws)
    this.showTerminals(ws.id)
  }

  async removeWorkspace(id: string, deleteBranch: boolean): Promise<void> {
    await this.api.workspace.remove({ id, deleteBranch })
    this.set((s) => ({
      workspaces: without(s.workspaces, id),
      view: s.view.kind === 'terminals' && s.view.key === id ? scratchView() : s.view
    }))
  }

  async openInEditor(path: string): Promise<void> {
    try {
      await this.api.app.openInEditor({ path })
    } catch (err) {
      this.fail(err)
    }
  }

  async createPr(id: string, title: string): Promise<string> {
    const { prUrl } = await this.api.workspace.createPr({ id, title })
    this.set((s) => {
      const ws = s.workspaces[id]
      return ws ? { workspaces: { ...s.workspaces, [id]: { ...ws, prUrl } } } : {}
    })
    return prUrl
  }

  fetchReport(): Promise<Report> {
    return this.api.report.get()
  }
}

/** Projects in creation order, without duplicates (the first copy wins). */
function mergeProjects(a: readonly Project[], b: readonly Project[]): Project[] {
  const seen = new Set(a.map((p) => p.id))
  return [...a, ...b.filter((p) => !seen.has(p.id))].sort((x, y) =>
    x.createdAt.localeCompare(y.createdAt)
  )
}

function scratchView(): View {
  return { kind: 'terminals', key: SCRATCH }
}

/** Appends the tabs not already present, keeping creation order. */
function mergeTabs(a: readonly TermTab[], b: readonly TermTab[]): TermTab[] {
  const seen = new Set(a.map((t) => t.id))
  return [...a, ...b.filter((t) => !seen.has(t.id))].sort((x, y) =>
    x.createdAt.localeCompare(y.createdAt)
  )
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
