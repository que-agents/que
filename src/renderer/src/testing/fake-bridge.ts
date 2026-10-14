// The fake window.que for renderer tests: an in-memory fixture book behind the
// same QueApi the preload exposes, emitting the events the daemon would.
// setup.ts installs `fakeBridge.api` as window.que and resets it after each test.
import type {
  Events,
  QueApi,
  TermInfo,
  Workspace,
  WorkspaceApi,
  WorkspaceEvents,
  WorkspaceStatus
} from '../../../preload/index.d'

/** QueApi plus the workspace surface the renderer will consume next. */
export type FakeQueApi = QueApi & { workspace: WorkspaceApi }

/** A terminal in the book: what term.list reports, plus what was typed into it. */
export interface FakeTerminal extends TermInfo {
  /** Everything written with term.write, in order. */
  input: string
  /** What term.attach and term.snapshot replay. */
  screen: string
}

type AnyEvents = Events & WorkspaceEvents
type Listener = (data: never) => void

function notFound(what: string, id: string): Error {
  return Object.assign(new Error(`no ${what} ${id}`), { code: 'not_found' })
}

class FakeBridge {
  readonly api: FakeQueApi
  private workspaces = new Map<string, Workspace>()
  private terminals = new Map<string, FakeTerminal>()
  private listeners = new Map<string, Set<Listener>>()
  private disconnectListeners = new Set<() => void>()
  private home = '/Users/dev'
  private folder: string | null = null

  constructor() {
    this.api = {
      term: {
        create: async (p) => {
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
            input: '',
            screen: ''
          })
          this.emit('term.created', { id })
          return { id }
        },
        list: async () => [...this.terminals.values()].map(toInfo),
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
      workspace: {
        list: async () => [...this.workspaces.values()].map((w) => ({ ...w })),
        get: async ({ id }) => {
          const ws = this.workspaces.get(id)
          if (!ws) throw notFound('workspace', id)
          return { ...ws }
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

  /** Updates a workspace's status and emits workspace.status, as the status engine would. */
  setStatus(id: string, status: WorkspaceStatus): void {
    const ws = this.workspaces.get(id)
    if (!ws) throw notFound('workspace', id)
    this.workspaces.set(id, { ...ws, status })
    this.emit('workspace.status', { id, status })
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
    this.workspaces.clear()
    this.terminals.clear()
    this.listeners.clear()
    this.disconnectListeners.clear()
    this.folder = null
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
