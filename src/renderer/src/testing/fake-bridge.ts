// The fake window.que for renderer tests: an in-memory fixture book behind the
// same QueApi the preload exposes, emitting the events the daemon would.
// setup.ts installs `fakeBridge.api` as window.que and resets it after each test.
import type {
  ConfigGetResult,
  ConfigSetParams,
  Events,
  Project,
  QueApi,
  QueueState,
  QuietState,
  QuietUnlock,
  Report,
  Task,
  TaskState,
  TermInfo,
  UpdateInfo,
  UserConfig,
  Workspace,
  WorkspaceStatus
} from '../../../preload/index.d'
import { QUIET_REFUSED_METHODS } from '../../../shared/protocol'
import { workspaceSlug } from '../../../shared/slug'
import { makeQuietState, makeUserConfig } from './fixtures'

export type FakeQueApi = QueApi

/** A terminal in the book: what term.list reports, plus what was typed into it. */
export interface FakeTerminal extends TermInfo {
  /** Everything written with term.write, in order. */
  input: string
  /** What term.attach and term.snapshot replay. */
  screen: string
}

type AnyEvents = Events
type Listener = (data: never) => void

function notFound(what: string, id: string): Error {
  return Object.assign(new Error(`no ${what} ${id}`), { code: 'not_found' })
}

function rpcError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

let idCounter = 0
function fakeId(prefix: 'prj_' | 'ws_' | 'tsk_'): string {
  idCounter += 1
  return `${prefix}fake${idCounter.toString(36).padStart(8, '0')}`
}

class FakeBridge {
  readonly api: FakeQueApi
  private projects = new Map<string, Project>()
  private workspaces = new Map<string, Workspace>()
  private terminals = new Map<string, FakeTerminal>()
  private listeners = new Map<string, Set<Listener>>()
  private disconnectListeners = new Set<() => void>()
  private tasks = new Map<string, Task>()
  private queue: QueueState = closedQueue()
  private home = '/Users/dev'
  private folder: string | null = null
  private tray = '● 0 ▸ 0 ✕ 0'
  private editorCalls: string[] = []
  private updateInfo: UpdateInfo | null = null
  private updateListeners = new Set<(info: UpdateInfo) => void>()
  private updateOpens = 0
  private prCalls: Array<{ id: string; title: string }> = []
  private quiet: QuietState = makeQuietState()
  private unlocks: QuietUnlock[] = []
  private unlockRequests: Array<{ minutes?: number; why?: string }> = []
  private configBook: ConfigGetResult = defaultConfigBook()
  private configSets: ConfigSetParams[] = []

  constructor() {
    this.api = {
      quiet: {
        state: async () => ({ ...this.quiet }),
        unlock: async (p) => {
          this.unlockRequests.push({ ...p })
          if (!this.quiet.inQuietHours) return { ...this.quiet }
          const minutes = p?.minutes ?? this.quiet.unlockMinutes
          const now = Date.now()
          this.unlocks.push({
            at: new Date(now).toISOString(),
            minutes,
            why: p?.why ?? null,
            endedAt: null
          })
          this.setQuietState({
            ...this.quiet,
            unlockedUntil: new Date(now + minutes * 60_000).toISOString()
          })
          return { ...this.quiet }
        },
        lock: async () => {
          const open = this.unlocks.find((u) => u.endedAt === null)
          if (open) open.endedAt = new Date().toISOString()
          this.setQuietState({ ...this.quiet, unlockedUntil: null })
          return { ...this.quiet }
        },
        log: async () => this.unlocks.map((u) => ({ ...u })),
        on: (event, cb) => this.subscribe(event, cb as Listener)
      },
      config: {
        get: async () => structuredClone(this.configBook),
        set: async (p) => {
          this.configSets.push(structuredClone(p))
          this.configBook = { ...this.configBook, raw: mergePatch(this.configBook.raw, p.patch) }
          this.emit('config.changed', structuredClone(this.configBook))
          return structuredClone(this.configBook)
        },
        on: (event, cb) => this.subscribe(event, cb as Listener)
      },
      term: {
        create: async (p) => {
          this.refuseIfQuiet('term.create')
          return this.createTerminal(p)
        },
        list: async (p) =>
          [...this.terminals.values()]
            .filter((t) => !p?.workspaceId || t.workspaceId === p.workspaceId)
            .map(toInfo),
        attach: async ({ id, cols, rows }) => {
          this.refuseIfQuiet('term.attach')
          const t = this.terminal(id)
          Object.assign(t, { cols, rows })
          return { snapshot: t.screen, cols, rows }
        },
        detach: async () => ({ ok: true }),
        write: ({ id, data }) => {
          const t = this.terminals.get(id)
          if (t?.alive) t.input += data
        },
        resize: async ({ id, cols, rows }) => {
          Object.assign(this.terminal(id), { cols, rows })
          return { ok: true }
        },
        kill: async ({ id }) => {
          this.terminal(id)
          this.terminals.delete(id)
          this.emit('term.killed', { id })
          return { ok: true }
        },
        snapshot: async ({ id }) => {
          this.refuseIfQuiet('term.snapshot')
          const t = this.terminal(id)
          return { serialized: t.screen, text: t.screen }
        },
        on: (event, cb) => this.subscribe(event, cb as Listener),
        onDisconnect: (cb) => {
          this.disconnectListeners.add(cb)
          return () => this.disconnectListeners.delete(cb)
        }
      },
      app: {
        homedir: async () => this.home,
        openFolder: async () => this.folder,
        openInEditor: async ({ path }) => {
          this.editorCalls.push(path)
          return { ok: true }
        },
        trayTitle: async () => this.tray,
        update: async () => (this.updateInfo ? { ...this.updateInfo } : null),
        onUpdate: (cb) => {
          this.updateListeners.add(cb)
          return () => this.updateListeners.delete(cb)
        },
        openUpdate: async () => {
          this.updateOpens++
          return { ok: true }
        },
        e2e: false
      },
      project: {
        add: async ({ path, name }) => {
          const existing = [...this.projects.values()].find((p) => p.path === path)
          if (existing) return { ...existing }
          const project: Project = {
            id: fakeId('prj_'),
            name: name ?? path.split('/').filter(Boolean).pop() ?? 'repo',
            path,
            defaultBranch: 'main',
            createdAt: new Date().toISOString()
          }
          this.projects.set(project.id, project)
          this.emit('project.added', { ...project })
          return { ...project }
        },
        list: async () => [...this.projects.values()].map((p) => ({ ...p })),
        remove: async ({ id, force }) => {
          if (!this.projects.has(id)) throw notFound('project', id)
          const open = [...this.workspaces.values()].filter((w) => w.projectId === id)
          if (open.length > 0 && !force) throw rpcError('conflict', `project ${id} has workspaces`)
          for (const w of open) this.removeWorkspace(w.id)
          this.projects.delete(id)
          this.emit('project.removed', { id })
          return { ok: true }
        },
        on: (event, cb) => this.subscribe(event, cb as Listener)
      },
      task: {
        add: async (p) => {
          this.refuseIfQuiet('task.add')
          const projectId = p.workspaceId ? this.workspace(p.workspaceId).projectId : p.projectId
          if (!projectId || !this.projects.has(projectId)) {
            throw notFound('project', projectId ?? '(none)')
          }
          if (!p.brief.trim()) throw rpcError('bad_request', 'brief is required')
          const now = new Date().toISOString()
          const task: Task = {
            id: fakeId('tsk_'),
            projectId,
            workspaceId: p.workspaceId ?? null,
            title: p.title ?? p.brief.split('\n')[0].trim().slice(0, 80),
            brief: p.brief,
            source: p.source ?? 'prompt',
            resumeSessionId: p.resumeSessionId ?? null,
            state: 'queued',
            reason: null,
            sessionId: null,
            pid: null,
            attempts: 0,
            costUsd: 0,
            turns: 0,
            maxTurns: p.maxTurns ?? 50,
            maxBudgetUsd: p.maxBudgetUsd ?? 5,
            permissionMode: null,
            branch: null,
            prUrl: null,
            resultText: null,
            lastActivityAt: null,
            startedAt: null,
            finishedAt: null,
            pausedUntil: null,
            createdAt: now,
            updatedAt: now
          }
          this.tasks.set(task.id, task)
          this.emit('task.created', { ...task })
          return { ...task }
        },
        list: async (p) =>
          [...this.tasks.values()]
            .filter((t) => !p?.state || t.state === p.state)
            .map((t) => ({ ...t })),
        get: async ({ id }) => ({ ...this.task(id) }),
        stop: async ({ id }) => {
          const t = this.task(id)
          if (!LIVE.has(t.state)) throw rpcError('conflict', `task ${id} is already ${t.state}`)
          this.setTaskState(id, 'stopped')
          return { ...this.task(id) }
        },
        remove: async ({ id }) => {
          const t = this.task(id)
          if (LIVE.has(t.state)) throw rpcError('conflict', `task ${id} is ${t.state}`)
          this.tasks.delete(id)
          return { ok: true }
        },
        on: (event, cb) => this.subscribe(event, cb as Listener)
      },
      queue: {
        open: async (p) => {
          this.refuseIfQuiet('queue.open')
          this.setQueueState({
            ...this.queue,
            open: true,
            concurrency: p?.concurrency ?? this.queue.concurrency,
            openedAt: new Date().toISOString()
          })
          return { ...this.queue }
        },
        close: async () => {
          this.setQueueState({ ...this.queue, open: false })
          return { ...this.queue }
        },
        state: async () => ({ ...this.queue }),
        on: (event, cb) => this.subscribe(event, cb as Listener)
      },
      report: {
        get: async (p) => {
          this.refuseIfQuiet('report.get')
          return this.report(p?.since)
        }
      },
      handoff: {
        create: async ({ workspaceId, brief }) => {
          this.refuseIfQuiet('handoff.create')
          const ws = this.workspace(workspaceId)
          if (!ws.sessionId) throw rpcError('bad_request', `workspace ${ws.name} has no session`)
          return this.api.task.add({
            workspaceId,
            brief,
            source: 'handoff',
            resumeSessionId: ws.sessionId
          })
        }
      },
      workspace: {
        create: async ({ projectId, name, baseRef, branch }) => {
          const project = this.projects.get(projectId)
          if (!project) throw notFound('project', projectId)
          const s = workspaceSlug(name)
          if (!s) throw rpcError('bad_request', `invalid workspace name ${name}`)
          const now = new Date().toISOString()
          const ws: Workspace = {
            id: fakeId('ws_'),
            projectId,
            name: s,
            branch: branch ?? s,
            path: `${this.home}/.que/worktrees/${project.name}/${s}`,
            baseRef: baseRef ?? `origin/${project.defaultBranch}`,
            status: 'preparing',
            statusReason: null,
            statusAt: now,
            lastActivityAt: null,
            sessionId: null,
            createdAt: now,
            archivedAt: null,
            prUrl: null
          }
          this.workspaces.set(ws.id, ws)
          this.emit('workspace.created', { ...ws })
          return { ...ws }
        },
        list: async (p) =>
          [...this.workspaces.values()]
            .filter((w) => !p?.projectId || w.projectId === p.projectId)
            .map((w) => ({ ...w })),
        get: async ({ id }) => ({ ...this.workspace(id) }),
        remove: async ({ id }) => {
          this.workspace(id)
          this.removeWorkspace(id)
          return { ok: true }
        },
        openTerminal: async ({ id, cols, rows }) => {
          this.refuseIfQuiet('workspace.openTerminal')
          const ws = this.workspace(id)
          return this.createTerminal({ cwd: ws.path, cols, rows, name: ws.name }, ws.id)
        },
        createPr: async ({ id, title }) => {
          this.refuseIfQuiet('workspace.createPr')
          const ws = this.workspace(id)
          if (!title.trim()) throw rpcError('bad_request', 'title is required')
          this.prCalls.push({ id, title })
          const prUrl = `https://github.com/rquellh/que/pull/${40 + this.prCalls.length}`
          this.workspaces.set(id, { ...ws, prUrl })
          this.emit('workspace.updated', { ...ws, prUrl })
          return { prUrl }
        },
        on: (event, cb) => this.subscribe(event, cb as Listener)
      }
    }
  }

  // ---- quiet hours and config ------------------------------------------------

  /** Replaces the quiet state and emits quiet.changed, as the daemon's clock would. */
  setQuietState(q: Partial<QuietState>): void {
    this.quiet = { ...this.quiet, ...q }
    this.emit('quiet.changed', { ...this.quiet })
  }

  /** Every quiet.unlock call's params, in order. */
  unlockCalls(): Array<{ minutes?: number; why?: string }> {
    return this.unlockRequests.map((c) => ({ ...c }))
  }

  /** Puts unlocks in the quiet log silently. Call before render(). */
  seedUnlocks(unlocks: QuietUnlock[]): void {
    this.unlocks = unlocks.map((u) => ({ ...u }))
  }

  /** Puts a config in the book silently (what config.get answers). Call before render(). */
  setConfig(config: Partial<UserConfig>, raw: Record<string, unknown> = {}): void {
    this.configBook = { ...this.configBook, config: makeUserConfig(config), raw }
  }

  /** Every config.set call's params, in order. */
  configSetCalls(): ConfigSetParams[] {
    return this.configSets.map((c) => structuredClone(c))
  }

  /** The daemon's refusal of detail while quiet hours are locked. */
  private refuseIfQuiet(method: (typeof QUIET_REFUSED_METHODS)[number]): void {
    if (!QUIET_REFUSED_METHODS.includes(method)) return
    if (this.quiet.inQuietHours && !this.quiet.unlockedUntil) {
      throw rpcError('quiet_hours', 'quiet hours until 07:00; run `que unlock` for 20 minutes')
    }
  }

  // ---- workspaces ----------------------------------------------------------

  /** Puts a workspace in the book silently: "already in the daemon". Call before render(). */
  seedWorkspace(ws: Workspace): void {
    this.workspaces.set(ws.id, { ...ws })
  }

  /** Puts a project in the book silently. Call before render(). */
  seedProject(project: Project): void {
    this.projects.set(project.id, { ...project })
  }

  /** Updates a workspace's status and emits workspace.status, as the status engine would. */
  setStatus(id: string, status: WorkspaceStatus, reason?: string): void {
    const ws = this.workspace(id)
    const at = new Date().toISOString()
    this.workspaces.set(id, { ...ws, status, statusReason: reason ?? null, statusAt: at })
    this.emit('workspace.status', { id, status, ...(reason ? { reason } : {}), at })
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id)
  }

  // ---- tasks and the queue -------------------------------------------------

  /** Puts a task in the book silently: "already in the daemon". Call before render(). */
  seedTask(task: Task): void {
    this.tasks.set(task.id, { ...task })
  }

  /** Moves a task to a state and emits task.status, as the task machine would. */
  setTaskState(id: string, state: TaskState, reason?: string): void {
    const t = this.task(id)
    const at = new Date().toISOString()
    const terminal = !LIVE.has(state)
    this.tasks.set(id, {
      ...t,
      state,
      reason: reason ?? null,
      updatedAt: at,
      finishedAt: terminal ? at : null
    })
    this.emit('task.status', { id, state, ...(reason ? { reason } : {}), at })
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  /** Replaces the queue state and emits queue.state. */
  setQueueState(q: QueueState): void {
    this.queue = { ...q }
    this.emit('queue.state', { ...q })
  }

  // ---- terminals -----------------------------------------------------------

  /** Puts a running terminal in the book silently, as if created before launch. */
  seedTerminal(info: TermInfo, screen = ''): void {
    this.terminals.set(info.id, { ...info, input: '', screen })
  }

  /** Marks a terminal exited and emits term.exit, as the daemon would. */
  exitTerminal(id: string, exitCode: number): void {
    this.terminal(id).alive = false
    this.emit('term.exit', { id, exitCode })
  }

  getTerminal(id: string): FakeTerminal | undefined {
    return this.terminals.get(id)
  }

  // ---- app -----------------------------------------------------------------

  /** What app.openFolder() resolves to (null = the user cancelled the picker). */
  setOpenFolderResult(dir: string | null): void {
    this.folder = dir
  }

  /** What app.trayTitle() resolves to. */
  setTrayTitle(title: string): void {
    this.tray = title
  }

  /**
   * What app.update() resolves to. Set before render to model a check that
   * finished before the window opened; set after render to emit onUpdate.
   */
  setUpdate(info: UpdateInfo | null): void {
    this.updateInfo = info
    if (info) for (const cb of this.updateListeners) cb({ ...info })
  }

  /** How many times app.openUpdate() was called. */
  openUpdateCalls(): number {
    return this.updateOpens
  }

  /** Every path app.openInEditor was asked to open, in order. */
  openInEditorCalls(): string[] {
    return [...this.editorCalls]
  }

  /** Every workspace.createPr call, in order. */
  createPrCalls(): Array<{ id: string; title: string }> {
    return this.prCalls.map((c) => ({ ...c }))
  }

  /** Replaces a task in the book and emits task.updated (cost, turns, PR changed). */
  updateTask(id: string, changes: Partial<Task>): void {
    const t = { ...this.task(id), ...changes, updatedAt: new Date().toISOString() }
    this.tasks.set(id, t)
    this.emit('task.updated', { ...t })
  }

  /** Drops the daemon connection: every onDisconnect listener fires. */
  disconnect(): void {
    for (const cb of this.disconnectListeners) cb()
  }

  /** Empties the book and drops listeners. setup.ts calls it after every test. */
  reset(): void {
    this.projects.clear()
    this.workspaces.clear()
    this.terminals.clear()
    this.tasks.clear()
    this.queue = closedQueue()
    this.listeners.clear()
    this.disconnectListeners.clear()
    this.folder = null
    this.tray = '● 0 ▸ 0 ✕ 0'
    this.editorCalls = []
    this.updateInfo = null
    this.updateListeners.clear()
    this.updateOpens = 0
    this.prCalls = []
    this.quiet = makeQuietState()
    this.unlocks = []
    this.unlockRequests = []
    this.configBook = defaultConfigBook()
    this.configSets = []
  }

  private workspace(id: string): Workspace {
    const ws = this.workspaces.get(id)
    if (!ws) throw notFound('workspace', id)
    return ws
  }

  private task(id: string): Task {
    const t = this.tasks.get(id)
    if (!t) throw notFound('task', id)
    return t
  }

  /** Every task in the book, grouped like the daemon's report (no time window). */
  private report(since?: string): Report {
    const groups: Report['groups'] = {
      done: [],
      stuck: [],
      failed: [],
      stopped: [],
      paused: [],
      running: [],
      queued: []
    }
    const totals = { tasks: 0, prs: 0, turns: 0, costUsd: 0, durationMs: 0 }
    for (const t of this.tasks.values()) {
      const group =
        t.state === 'preparing' || t.state === 'finishing'
          ? 'running'
          : (t.state as keyof typeof groups)
      const durationMs =
        t.startedAt && t.finishedAt ? Date.parse(t.finishedAt) - Date.parse(t.startedAt) : null
      groups[group].push({
        id: t.id,
        title: t.title,
        state: t.state,
        reason: t.reason,
        workspace: t.workspaceId ? (this.workspaces.get(t.workspaceId)?.name ?? null) : null,
        branch: t.branch,
        prUrl: t.prUrl,
        durationMs,
        turns: t.turns,
        costUsd: t.costUsd
      })
      totals.tasks += 1
      totals.prs += t.prUrl ? 1 : 0
      totals.turns += t.turns
      totals.costUsd += t.costUsd
      totals.durationMs += durationMs ?? 0
    }
    const now = new Date().toISOString()
    return { since: since ?? now, generatedAt: now, groups, totals }
  }

  private removeWorkspace(id: string): void {
    for (const t of [...this.terminals.values()]) {
      if (t.workspaceId === id) {
        this.terminals.delete(t.id)
        this.emit('term.killed', { id: t.id })
      }
    }
    this.workspaces.delete(id)
    this.emit('workspace.removed', { id })
  }

  private createTerminal(
    p: { cwd?: string; cols: number; rows: number; name?: string; file?: string },
    workspaceId?: string
  ): { id: string } {
    const id = crypto.randomUUID()
    const file = p.file ?? '/bin/zsh'
    this.terminals.set(id, {
      id,
      name: p.name || file.split('/').pop() || 'shell',
      cwd: p.cwd ?? this.home,
      cols: p.cols,
      rows: p.rows,
      pid: 40_000 + this.terminals.size,
      alive: true,
      createdAt: new Date().toISOString(),
      ...(workspaceId ? { workspaceId } : {}),
      input: '',
      screen: ''
    })
    this.emit('term.created', { id })
    return { id }
  }

  private terminal(id: string): FakeTerminal {
    const t = this.terminals.get(id)
    if (!t) throw notFound('terminal', id)
    return t
  }

  private subscribe(event: string, cb: Listener): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(cb)
    return () => set.delete(cb)
  }

  private emit<E extends keyof AnyEvents>(event: E, data: AnyEvents[E]): void {
    for (const cb of this.listeners.get(event) ?? []) (cb as (d: AnyEvents[E]) => void)(data)
  }
}

function toInfo({ input: _input, screen: _screen, ...info }: FakeTerminal): TermInfo {
  return info
}

const LIVE: ReadonlySet<TaskState> = new Set([
  'queued',
  'preparing',
  'running',
  'paused',
  'finishing'
])

function defaultConfigBook(): ConfigGetResult {
  return { path: '/Users/dev/.config/que/config.toml', config: makeUserConfig(), raw: {} }
}

function isTable(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** config.set's merge: tables merge, anything else replaces, null removes. */
function mergePatch(
  raw: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else if (isTable(v)) out[k] = mergePatch(isTable(out[k]) ? out[k] : {}, v)
    else out[k] = v
  }
  return out
}

function closedQueue(): QueueState {
  return { open: false, concurrency: 2, running: 0, queued: 0, paused: 0, openedAt: null }
}

export const fakeBridge = new FakeBridge()
