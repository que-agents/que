// The fake window.que for renderer tests: an in-memory fixture book behind the
// same QueApi the preload exposes, emitting the events the daemon would.
// setup.ts installs `fakeBridge.api` as window.que and resets it after each test.
import type {
  Events,
  Project,
  QueApi,
  TermInfo,
  Workspace,
  WorkspaceStatus
} from '../../../preload/index.d'

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
function fakeId(prefix: 'prj_' | 'ws_'): string {
  idCounter += 1
  return `${prefix}fake${idCounter.toString(36).padStart(8, '0')}`
}

/** Same rule as the daemon's slugify (src/shared/slug.ts). */
function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
}

class FakeBridge {
  readonly api: FakeQueApi
  private projects = new Map<string, Project>()
  private workspaces = new Map<string, Workspace>()
  private terminals = new Map<string, FakeTerminal>()
  private listeners = new Map<string, Set<Listener>>()
  private disconnectListeners = new Set<() => void>()
  private home = '/Users/dev'
  private folder: string | null = null

  constructor() {
    this.api = {
      term: {
        create: async (p) => this.createTerminal(p),
        list: async (p) =>
          [...this.terminals.values()]
            .filter((t) => !p?.workspaceId || t.workspaceId === p.workspaceId)
            .map(toInfo),
        attach: async ({ id, cols, rows }) => {
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
          return { ...project }
        },
        list: async () => [...this.projects.values()].map((p) => ({ ...p })),
        remove: async ({ id, force }) => {
          if (!this.projects.has(id)) throw notFound('project', id)
          const open = [...this.workspaces.values()].filter((w) => w.projectId === id)
          if (open.length > 0 && !force) throw rpcError('conflict', `project ${id} has workspaces`)
          for (const w of open) this.removeWorkspace(w.id)
          this.projects.delete(id)
          return { ok: true }
        }
      },
      workspace: {
        create: async ({ projectId, name, baseRef, branch }) => {
          const project = this.projects.get(projectId)
          if (!project) throw notFound('project', projectId)
          const s = slug(name)
          if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(s)) {
            throw rpcError('bad_request', `invalid workspace name ${name}`)
          }
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
            archivedAt: null
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
          const ws = this.workspace(id)
          return this.createTerminal({ cwd: ws.path, cols, rows, name: ws.name }, ws.id)
        },
        on: (event, cb) => this.subscribe(event, cb as Listener)
      }
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

  /** Drops the daemon connection: every onDisconnect listener fires. */
  disconnect(): void {
    for (const cb of this.disconnectListeners) cb()
  }

  /** Empties the book and drops listeners. setup.ts calls it after every test. */
  reset(): void {
    this.projects.clear()
    this.workspaces.clear()
    this.terminals.clear()
    this.listeners.clear()
    this.disconnectListeners.clear()
    this.folder = null
  }

  private workspace(id: string): Workspace {
    const ws = this.workspaces.get(id)
    if (!ws) throw notFound('workspace', id)
    return ws
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

export const fakeBridge = new FakeBridge()
