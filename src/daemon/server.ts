import fs from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import {
  ErrorCodes,
  MessageDecoder,
  encode,
  type EventName,
  type Events,
  type Methods,
  type PingResult,
  type Request,
  type ResponseError
} from '../shared/protocol'
import {
  configPath,
  defaultConfig,
  formatConfigErrors,
  loadConfig,
  loadRepoConfig,
  mergeConfigPatch,
  parseConfig,
  readRawConfig,
  stringifyConfig,
  type UserConfig
} from '../shared/config'
import { decodeHookEvent } from '../shared/hook.decode'
import { ensureDirs, quePaths, type QuePaths } from '../shared/paths'
import type {
  ConfigGetResult,
  InstructionsGetResult,
  TaskAddParams,
  TermCreateParams,
  TermInfo,
  WorkspaceStartResult
} from '../shared/protocol'
import { type TaskSource, type TaskState, type Workspace } from '../shared/types'
import { EventBus } from './bus'
import { RpcError } from './errors'
import type { HostedTerminal, PtyHost, TermExtra } from './pty-host'
import { QuietService } from './quiet'
import { TaskQueue } from './queue'
import { SYSTEM_PROMPT } from './runner'
import { PrService } from './prs'
import { StatusService } from './status'
import { Summarizer } from './summarizer'
import { TicketService } from './tickets'
import { Store } from './store'
import { workspaceDiff } from './diff'
import { readWorkspaceFile, workspaceFiles } from './files'
import {
  sessionEnv,
  WorkspaceManager,
  workspaceTerminalEnv,
  type WorkspaceTerminalEnv
} from './workspaces'
import { WorktreeWatcher } from './watcher'
import { defaultCliScript, installWrapper, resolveCliRunner, startCommand } from './wrapper'
import { errorCode, errorMessage } from '../shared/errors.decode'

export interface ServerOptions {
  host: PtyHost
  version: string
  startedAt?: string
  log?: (msg: string) => void
  /** Called after the daemon.shutdown response has been flushed. */
  onShutdown?: () => void
  /** Defaults to quePaths() at construction. */
  paths?: QuePaths
  /** The CLI bin/que runs. Defaults to the bundled out/cli/index.js. */
  cliScript?: string
  /** Status engine stall-check interval. Default 5 s. */
  statusTickMs?: number
  /** Task queue stall / pause tick. Default 5 s. */
  queueTickMs?: number
  /** Quiet-hours re-evaluation interval. Default 15 s. */
  quietTickMs?: number
  /** How long a sidebar-title summary call may run. Default 60 s. */
  summaryTimeoutMs?: number
  /** The clock quiet hours and the summary throttle read. Default Date.now. */
  now?: () => number
  /** Draws the name of a workspace created without one. Default randomWorkspaceName. */
  randomWorkspaceName?: () => string
}

interface Subscription {
  /** Live data buffered while an attach snapshot is being taken. */
  pending: string[] | null
}

/** Work to run after a response is written (e.g. flushing buffered data). */
type AfterSend = (fn: () => void) => void

class Connection {
  readonly subs = new Map<string, Subscription>()
  /**
   * The workspaces this connection asked to watch with workspace.watch. This
   * is the only input to worktree watching, and it goes away with the connection.
   */
  readonly watches = new Set<string>()
  private decoder: MessageDecoder<Request>

  constructor(
    readonly socket: net.Socket,
    readonly server: DaemonServer
  ) {
    this.decoder = new MessageDecoder<Request>((line) =>
      server.log(`bad frame from client: ${line.slice(0, 200)}`)
    )
    socket.setNoDelay(true)
    socket.on('data', (chunk) => {
      for (const req of this.decoder.push(chunk)) void server.dispatch(this, req)
    })
    socket.on('error', () => {
      // Clients disappear without ceremony; 'close' does the cleanup.
    })
  }

  send(msg: unknown): void {
    if (this.socket.destroyed || !this.socket.writable) return
    this.socket.write(encode(msg))
  }

  sendEvent<E extends EventName>(event: E, data: Events[E]): void {
    this.send({ event, data })
  }
}

/** How long a read of the user config trusts the last stat of its file. */
const CONFIG_RECHECK_MS = 1_000

export class DaemonServer {
  private server: net.Server | null = null
  private conns = new Set<Connection>()
  private unsubs: Array<() => void> = []
  private socketPath = ''
  private closed = false
  /** Workspace of each workspace terminal, kept past the terminal's removal. */
  private termWorkspace = new Map<string, string>()
  /** Every service reports events here; the server sends them on to the connections. */
  readonly bus = new EventBus({ log: (m) => this.log(m) })
  readonly startedAt: string
  readonly paths: QuePaths
  readonly store: Store
  readonly status: StatusService
  readonly prs: PrService
  readonly tickets: TicketService
  readonly workspaces: WorkspaceManager
  readonly tasks: TaskQueue
  readonly quiet: QuietService
  readonly summaries: Summarizer
  /** The last good user config, the file stamp it was read at, and when the file was last statted. */
  private config: UserConfig
  private configStamp = ''
  private configCheckedAt = Number.NEGATIVE_INFINITY
  /** Watches the worktrees of workspaces with an attached terminal (workspace.changed). */
  readonly watcher = new WorktreeWatcher((id) => this.bus.emit('workspace.changed', { id }), {
    log: (m) => this.log(m)
  })

  constructor(private opts: ServerOptions) {
    this.startedAt = opts.startedAt ?? new Date().toISOString()
    const { host } = opts
    this.paths = ensureDirs(opts.paths ?? quePaths())
    this.store = new Store(this.paths.db)
    this.config = defaultConfig({ queHome: this.paths.home })
    const { emit } = this.bus
    this.bus.onAny((event, data) => {
      for (const c of this.conns) c.sendEvent(event, data)
    })
    this.bus.on('workspace.removed', () => this.syncWatches())
    this.status = new StatusService({
      store: this.store,
      emit,
      config: () => this.configOrDefault(),
      log: (m) => this.log(m),
      tickMs: opts.statusTickMs
    })
    this.workspaces = new WorkspaceManager({
      store: this.store,
      paths: this.paths,
      status: this.status,
      emit,
      killTerminals: (id) => this.killWorkspaceTerminals(id),
      log: (m) => this.log(m),
      randomName: opts.randomWorkspaceName
    })
    this.summaries = new Summarizer({
      store: this.store,
      paths: this.paths,
      emit,
      bus: this.bus,
      config: () => this.configOrDefault(),
      transcriptPath: (id) => this.status.transcriptPath(id),
      log: (m) => this.log(m),
      now: opts.now,
      timeoutMs: opts.summaryTimeoutMs
    })
    this.tasks = new TaskQueue({
      store: this.store,
      paths: this.paths,
      workspaces: this.workspaces,
      status: this.status,
      emit,
      config: () => this.configOrDefault(),
      killTerminals: (id) => this.killWorkspaceTerminals(id),
      socket: () => this.socketPath,
      log: (m) => this.log(m),
      tickMs: opts.queueTickMs
    })
    this.prs = new PrService({
      store: this.store,
      workspaces: this.workspaces,
      tasks: this.tasks,
      paths: this.paths,
      bus: this.bus,
      emit,
      config: () => this.configOrDefault(),
      log: (m) => this.log(m)
    })
    this.tickets = new TicketService({
      store: this.store,
      config: () => this.configOrDefault(),
      emit,
      log: (m) => this.log(m),
      home: this.paths.home,
      projects: () => this.workspaces.listProjects(),
      createWorkspace: (p) => this.workspaces.create(p),
      openTerminal: async (workspaceId) => this.openWorkspaceTerminal(workspaceId, 120, 30),
      createSession: async (cwd) => this.createTerminal({ cwd, cols: 120, rows: 30 }).info(),
      writeTerminal: (id, data) => this.requireTerm(id).write(data),
      learnProject: async (projectKey, projectName) => {
        this.setConfig({ jira: { projects: { [projectKey]: projectName } } }, false)
      }
    })
    this.quiet = new QuietService({
      store: this.store,
      emit,
      config: () => this.configOrDefault(),
      detachAll: () => {
        for (const c of this.conns) c.subs.clear()
      },
      report: (since) => this.tasks.report(since),
      log: (m) => this.log(m),
      now: opts.now,
      tickMs: opts.quietTickMs
    })
    this.unsubs.push(
      host.onData((id, data) => {
        for (const c of this.conns) {
          const sub = c.subs.get(id)

          if (!sub) continue

          if (sub.pending) sub.pending.push(data)
          else c.sendEvent('term.data', { id, data })
        }
      }),
      host.onExit((id, info) => {
        this.log(`term ${id} exited code=${info.exitCode} signal=${info.signal ?? ''}`)
        this.bus.emit('term.exit', { id, exitCode: info.exitCode, signal: info.signal })
        const wsId = this.termWorkspace.get(id)

        if (wsId) {
          this.termWorkspace.delete(id)
          const live = host.list().some((t) => t.alive && t.workspaceId === wsId)

          if (!live) this.status.apply(wsId, { kind: 'terminal_exit' })
        }
      })
    )
  }

  /**
   * The user config, re-read when the file changes. The file is statted at most
   * once a second (hooks, stream messages and every tick read the config), so a
   * hand edit is seen within a second; config.set rereads at once. An invalid
   * file keeps the last good config.
   */
  private configOrDefault(): UserConfig {
    const now = performance.now()

    if (now - this.configCheckedAt < CONFIG_RECHECK_MS) return this.config

    this.configCheckedAt = now
    const path = configPath()
    let stamp = `${path}:missing`

    try {
      const st = fs.statSync(path)
      stamp = `${path}:${st.mtimeMs}:${st.size}`
    } catch {
      // No file: the defaults.
    }

    if (stamp !== this.configStamp) {
      this.configStamp = stamp
      const r = loadConfig({ queHome: this.paths.home }, path)

      if (r.ok) this.config = r.config
      else
        this.log(
          `config ${path} is invalid; keeping the last good one: ${formatConfigErrors(r.errors)}`
        )
    }

    return this.config
  }

  private getConfig(): ConfigGetResult {
    const path = configPath()
    const raw = readRawConfig(path)

    return { path, config: this.configOrDefault(), raw: raw.ok ? raw.config : {} }
  }

  /** Merges a patch into the config file, validates, writes, and reloads it. */
  private setConfig(patch: unknown, applyTonight: boolean): ConfigGetResult {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new RpcError(ErrorCodes.BadRequest, 'patch must be an object')
    }

    const path = configPath()
    const raw = readRawConfig(path)

    if (!raw.ok) {
      throw new RpcError(ErrorCodes.BadRequest, `${path}: ${formatConfigErrors(raw.errors)}`)
    }

    const merged = mergeConfigPatch(raw.config, patch as Record<string, unknown>)
    // smol-toml writes the table back without the file's comments.
    const text = stringifyConfig(merged)
    const parsed = parseConfig(text, { queHome: this.paths.home })

    if (!parsed.ok) {
      throw new RpcError(
        ErrorCodes.BadRequest,
        `invalid config: ${formatConfigErrors(parsed.errors)}`
      )
    }

    fs.mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    fs.writeFileSync(tmp, text.endsWith('\n') ? text : `${text}\n`)
    fs.renameSync(tmp, path)
    this.configStamp = ''
    this.configCheckedAt = Number.NEGATIVE_INFINITY
    this.configOrDefault()
    this.log(`config ${path} updated${applyTonight ? ' (apply tonight)' : ''}`)
    this.quiet.configChanged(applyTonight)
    this.tasks.kick()
    const result = this.getConfig()
    this.bus.emit('config.changed', result)

    return result
  }

  private createTerminal(params: TermCreateParams, extra?: TermExtra): HostedTerminal {
    const t = this.opts.host.create(params, extra)

    if (extra?.workspaceId) this.termWorkspace.set(t.id, extra.workspaceId)
    this.log(`term ${t.id} created pid=${t.proc.pid} cwd=${t.cwd}`)
    this.bus.emit('term.created', t.info())

    return t
  }

  /** A shell in the workspace's worktree, carrying its que environment. */
  private openWorkspaceTerminal(id: string, cols: number, rows: number): TermInfo {
    const ws = this.workspaces.get(id)

    const t = this.createTerminal(
      { cwd: ws.path, cols, rows, name: ws.name },
      { workspaceId: ws.id, env: this.terminalEnv(ws) }
    )

    return t.info()
  }

  private requireTerm(id: string): HostedTerminal {
    const t = this.opts.host.get(id)

    if (!t) throw new RpcError(ErrorCodes.NotFound, `no terminal ${id}`)

    return t
  }

  /**
   * Starts claude on the brief (or the configured start prompt) in the workspace's first terminal (opened when it has
   * none). Answers with the terminal at once; the command is typed once setup has ended.
   */
  private startWorkspace(id: string, cols = 120, rows = 30): WorkspaceStartResult {
    const ws = this.workspaces.get(id)

    const first =
      this.opts.host.list().find((t) => t.alive && t.workspaceId === ws.id) ??
      this.createTerminal(
        { cwd: ws.path, cols, rows, name: ws.name },
        { workspaceId: ws.id, env: this.terminalEnv(ws) }
      )

    const command = startCommand(
      this.configOrDefault().startPrompt,
      ws.brief ? join(ws.path, '.que', 'brief.md') : null
    )

    void this.status.setupDone(ws.id).then(() => {
      // Shutdown releases the wait too; nothing is typed into a terminal that is being torn down.
      if (this.closed) return
      const t = this.opts.host.get(first.id)

      if (t?.alive) t.write(command)
      else this.log(`workspace ${ws.id}: terminal ${first.id} is gone; claude not started`)
    })

    return { terminal: first.info() }
  }

  private killTerminal(id: string): boolean {
    if (!this.opts.host.kill(id)) return false
    this.log(`term ${id} killed`)

    for (const c of this.conns) c.subs.delete(id)
    this.bus.emit('term.killed', { id })

    return true
  }

  /**
   * A workspace terminal's environment, with the instructions file and the
   * permission mode from the current config and the project's que.toml.
   */
  private terminalEnv(ws: Workspace): WorkspaceTerminalEnv {
    const repo = loadRepoConfig(this.workspaces.project(ws.projectId).path)

    if (!repo.ok) this.log(`que.toml for ${ws.name} is invalid: ${formatConfigErrors(repo.errors)}`)
    const session = sessionEnv(this.configOrDefault(), repo.ok ? repo.config : {})

    return workspaceTerminalEnv(ws, this.paths, this.socketPath, session)
  }

  private getInstructions(): InstructionsGetResult {
    const path = this.configOrDefault().instructionsFile

    if (!path) return { exists: false, content: '' }

    try {
      return { path, exists: true, content: fs.readFileSync(path, 'utf8') }
    } catch (err) {
      if (errorCode(err) === 'ENOENT') return { path, exists: false, content: '' }

      throw new RpcError(ErrorCodes.BadRequest, `${path}: ${errorMessage(err)}`)
    }
  }

  private setInstructions(content: string): InstructionsGetResult {
    const path = this.configOrDefault().instructionsFile

    if (!path) {
      throw new RpcError(
        ErrorCodes.NotConfigured,
        'no instructions file: set instructions_file in the que config first'
      )
    }

    fs.mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    fs.writeFileSync(tmp, content)
    fs.renameSync(tmp, path)
    this.log(`instructions ${path} updated`)

    return this.getInstructions()
  }

  /** Kills every terminal of a workspace; returns how many were still alive. */
  private killWorkspaceTerminals(workspaceId: string): number {
    let alive = 0

    for (const t of this.opts.host.list()) {
      if (t.workspaceId === workspaceId) {
        if (t.alive) alive += 1
        this.termWorkspace.delete(t.id)
        this.killTerminal(t.id)
      }
    }

    return alive
  }

  log(msg: string): void {
    this.opts.log?.(msg)
  }

  listen(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        const conn = new Connection(socket, this)
        this.conns.add(conn)
        socket.on('close', () => {
          // Subscriptions are per-connection; terminals keep running.
          conn.subs.clear()
          conn.watches.clear()
          this.conns.delete(conn)
          this.syncWatches()
        })
      })

      server.once('error', reject)
      server.listen(socketPath, () => {
        server.off('error', reject)
        this.socketPath = socketPath

        try {
          installWrapper({
            paths: this.paths,
            ...resolveCliRunner(),
            cliScript: this.opts.cliScript ?? defaultCliScript()
          })
        } catch (err) {
          this.log(`installing the hooks wrapper failed: ${errorMessage(err)}`)
        }

        try {
          fs.writeFileSync(this.paths.systemPrompt, SYSTEM_PROMPT, { mode: 0o644 })
        } catch (err) {
          this.log(`writing ${this.paths.systemPrompt} failed: ${errorMessage(err)}`)
        }

        this.status.start()
        this.tasks.start()
        this.quiet.start()
        this.prs.start()
        this.tickets.start()
        server.on('error', (err) => this.log(`server error: ${err.message}`))

        try {
          fs.chmodSync(socketPath, 0o600)
        } catch (err) {
          this.log(`chmod socket failed: ${errorMessage(err)}`)
        }

        this.server = server
        resolve()
      })
    })
  }

  /**
   * Stops accepting connections and drops existing ones, and stops every task
   * run (restart recovery resumes them). Does not kill PTYs.
   */
  async close(): Promise<void> {
    for (const u of this.unsubs) u()
    this.unsubs = []

    if (!this.closed) {
      this.closed = true
      this.quiet.stop()
      this.prs.stop()
      await this.prs.drain()
      this.tickets.stop()
      await this.tickets.drain()
      await this.tasks.shutdown()
      await this.summaries.close()
      this.status.stop()
      this.watcher.close()
      this.workspaces.close()
      this.store.close()
    }

    for (const c of this.conns) c.socket.destroy()
    this.conns.clear()
    const server = this.server
    this.server = null

    if (!server) return Promise.resolve()

    return new Promise((resolve) => server.close(() => resolve()))
  }

  /**
   * Watches the worktree of every workspace some connection asked to watch
   * with workspace.watch, and nothing else. Terminals do not matter here: a
   * client that wants a workspace watched says so, and its watches end when it
   * unwatches or its connection closes. Call this when that set changes or a
   * watched workspace goes away.
   */
  private syncWatches(): void {
    if (this.closed) {
      this.watcher.close()

      return
    }

    const ids = new Set<string>()

    for (const c of this.conns) {
      for (const id of c.watches) ids.add(id)
    }

    const wanted = new Map<string, string>()

    for (const id of ids) {
      const ws = this.store.getWorkspace(id)

      if (ws && !ws.archivedAt) wanted.set(ws.id, ws.path)
    }

    this.watcher.sync(wanted)
  }

  async dispatch(conn: Connection, req: Request): Promise<void> {
    if (typeof req !== 'object' || req === null || typeof req.id !== 'number') {
      this.log('dropping request without numeric id')

      return
    }

    if (typeof req.method !== 'string') {
      conn.send({ id: req.id, error: err(ErrorCodes.BadRequest, 'method must be a string') })

      return
    }

    const after: Array<() => void> = []

    try {
      const result = await this.handle(conn, req.method, req.params ?? {}, (fn) => after.push(fn))
      conn.send({ id: req.id, result })

      for (const fn of after) fn()

      if (req.method === 'daemon.shutdown') {
        // Let the response reach the client before tearing everything down.
        conn.socket.end(() => this.opts.onShutdown?.())
        setTimeout(() => this.opts.onShutdown?.(), 500).unref()
      }
    } catch (e) {
      const error =
        e instanceof RpcError ? err(e.code, e.message) : err(ErrorCodes.Internal, errorMessage(e))

      if (!(e instanceof RpcError)) this.log(`${req.method} failed: ${error.message}`)
      conn.send({ id: req.id, error })
    }
  }

  private async handle(
    conn: Connection,
    method: string,
    p: Record<string, unknown>,
    afterSend: AfterSend
  ): Promise<Methods[keyof Methods]['result']> {
    const { host } = this.opts
    // Quiet hours: detail is refused here, so every client gets the same answer.
    this.quiet.check(method)

    switch (method) {
      case 'daemon.ping': {
        const r: PingResult = {
          version: this.opts.version,
          pid: process.pid,
          startedAt: this.startedAt,
          nodeVersion: process.version,
          path: process.env.PATH ?? ''
        }

        return r
      }

      case 'daemon.shutdown':
        return { ok: true }
      case 'term.create': {
        const t = this.createTerminal({
          cwd: optString(p, 'cwd'),
          cols: num(p, 'cols'),
          rows: num(p, 'rows'),
          name: optString(p, 'name'),
          file: optString(p, 'file'),
          args: optStringArray(p, 'args')
        })

        return t.info()
      }

      case 'term.list': {
        const workspaceId = optString(p, 'workspaceId')

        return host
          .list()
          .filter((t) => !workspaceId || t.workspaceId === workspaceId)
          .map((t) => t.info())
      }

      case 'term.attach': {
        const t = this.requireTerm(str(p, 'id'))
        const cols = num(p, 'cols')
        const rows = num(p, 'rows')
        // Buffer live output from this instant; the snapshot below covers
        // everything before it, so nothing is lost or duplicated.
        const sub: Subscription = { pending: [] }
        conn.subs.set(t.id, sub)

        try {
          t.resize(cols, rows)
          const snapshot = await t.serializeNow()
          afterSend(() => flushPending(conn, t.id, sub))

          return { snapshot, cols: t.cols, rows: t.rows }
        } catch (e) {
          if (conn.subs.get(t.id) === sub) conn.subs.delete(t.id)
          throw e
        }
      }

      case 'term.detach': {
        conn.subs.delete(str(p, 'id'))

        return { ok: true }
      }

      case 'term.write': {
        this.requireTerm(str(p, 'id')).write(str(p, 'data'))

        return { ok: true }
      }

      case 'term.resize': {
        this.requireTerm(str(p, 'id')).resize(num(p, 'cols'), num(p, 'rows'))

        return { ok: true }
      }

      case 'term.kill': {
        const id = str(p, 'id')

        if (!this.killTerminal(id)) throw new RpcError(ErrorCodes.NotFound, `no terminal ${id}`)

        return { ok: true }
      }

      case 'term.snapshot':
        return this.requireTerm(str(p, 'id')).snapshot()
      case 'project.add': {
        const before = new Set(this.workspaces.listProjects().map((x) => x.id))

        const project = await this.workspaces.addProject({
          path: optString(p, 'path'),
          repo: optString(p, 'repo'),
          cwd: optString(p, 'cwd'),
          name: optString(p, 'name')
        })

        if (!before.has(project.id)) this.bus.emit('project.added', project)

        return project
      }

      case 'project.list':
        return this.workspaces.listProjects()
      case 'project.remove':
        await this.workspaces.removeProject(str(p, 'id'), optBool(p, 'force'))
        this.bus.emit('project.removed', { id: str(p, 'id') })

        return { ok: true }
      case 'workspace.create':
        return this.workspaces.create({
          projectId: str(p, 'projectId'),
          name: optString(p, 'name'),
          title: optString(p, 'title'),
          brief: optString(p, 'brief'),
          baseRef: optString(p, 'baseRef'),
          branch: optString(p, 'branch')
        })
      case 'workspace.start':
        return this.startWorkspace(str(p, 'id'), optNumber(p, 'cols'), optNumber(p, 'rows'))
      case 'workspace.rename':
        return this.workspaces.rename({
          id: str(p, 'id'),
          title: str(p, 'title'),
          branch: optString(p, 'branch')
        })
      case 'workspace.canRenameBranch':
        return { allowed: await this.workspaces.canRenameBranch(str(p, 'id')) }
      case 'workspace.list':
        return this.workspaces.list(optString(p, 'projectId'))
      case 'workspace.get':
        return this.workspaces.get(str(p, 'id'))
      case 'workspace.remove':
        this.tasks.stopWorkspace(str(p, 'id'))
        await this.workspaces.remove({ id: str(p, 'id'), deleteBranch: optBool(p, 'deleteBranch') })

        return { ok: true }
      case 'workspace.openTerminal':
        return this.openWorkspaceTerminal(str(p, 'id'), num(p, 'cols'), num(p, 'rows'))

      case 'workspace.diff': {
        const ws = this.workspaces.get(str(p, 'id'))

        return workspaceDiff(ws, this.workspaces.project(ws.projectId), Date.now, {
          base: optString(p, 'base'),
          commit: optString(p, 'commit')
        })
      }

      case 'workspace.watch':
        conn.watches.add(this.workspaces.get(str(p, 'id')).id)
        this.syncWatches()

        return { ok: true }
      case 'workspace.unwatch':
        conn.watches.delete(str(p, 'id'))
        this.syncWatches()

        return { ok: true }
      case 'workspace.files':
        return workspaceFiles(this.workspaces.get(str(p, 'id')), Date.now)
      case 'workspace.readFile':
        return readWorkspaceFile(this.workspaces.get(str(p, 'id')), str(p, 'path'))
      case 'workspace.prThread': {
        const ws = this.workspaces.get(str(p, 'id'))

        return this.prs.thread(ws.id, optBool(p, 'refresh') === true)
      }

      case 'workspace.createPr':
        return this.prs.create(str(p, 'id'), str(p, 'title'))
      case 'hook.event': {
        const ws = this.workspaces.get(str(p, 'workspaceId'))
        const payload = decodeHookEvent(p.payload)

        if (!payload) throw new RpcError(ErrorCodes.BadRequest, 'payload must be a hook event')

        this.status.hook(ws.id, payload)

        if (payload.hook_event_name === 'Stop' && !payload.agent_id) this.summaries.stopped(ws.id)

        const taskId = optString(p, 'taskId')

        if (taskId) this.tasks.hook(taskId, payload)

        return { ok: true }
      }

      case 'task.add': {
        const params: TaskAddParams = {
          projectId: optString(p, 'projectId'),
          workspaceId: optString(p, 'workspaceId'),
          title: optString(p, 'title'),
          brief: str(p, 'brief'),
          source: optString(p, 'source') as TaskSource | undefined,
          resumeSessionId: optString(p, 'resumeSessionId'),
          maxTurns: optNumber(p, 'maxTurns'),
          maxBudgetUsd: optNumber(p, 'maxBudgetUsd')
        }

        return this.tasks.add(params)
      }

      case 'task.list':
        return this.tasks.list({ state: optString(p, 'state') as TaskState | undefined })
      case 'task.get':
        return this.tasks.get(str(p, 'id'))
      case 'task.stop':
        return this.tasks.stop(str(p, 'id'))
      case 'task.remove':
        this.tasks.remove(str(p, 'id'))

        return { ok: true }
      case 'queue.open':
        return this.tasks.open(optNumber(p, 'concurrency'))
      case 'queue.close':
        return this.tasks.close()
      case 'queue.state':
        return this.tasks.state()
      case 'report.get':
        return this.tasks.report(optString(p, 'since'))
      case 'quiet.state':
        return this.quiet.state()
      case 'quiet.unlock':
        return this.quiet.unlockFor(optNumber(p, 'minutes'), optString(p, 'why'))
      case 'quiet.lock':
        return this.quiet.lock()
      case 'quiet.log':
        return this.quiet.log(optString(p, 'since'))
      case 'tickets.list':
        return this.tickets.list()
      case 'tickets.sync':
        return this.tickets.sync()
      case 'tickets.start':
        return this.tickets.startTicket({
          key: str(p, 'key'),
          projectId: optString(p, 'projectId'),
          session: optBool(p, 'session')
        })
      case 'tickets.projectFor':
        return { projectId: this.tickets.projectFor(str(p, 'key')) }
      case 'config.get':
        return this.getConfig()
      case 'config.set':
        return this.setConfig(p.patch, optBool(p, 'applyTonight') === true)
      case 'instructions.get':
        return this.getInstructions()
      case 'instructions.set':
        return this.setInstructions(str(p, 'content'))
      default:
        throw new RpcError(ErrorCodes.UnknownMethod, `unknown method ${method}`)
    }
  }
}

function flushPending(conn: Connection, id: string, sub: Subscription): void {
  // A later attach/detach on this connection replaced this subscription.
  if (conn.subs.get(id) !== sub || !sub.pending) return
  const pending = sub.pending
  sub.pending = null

  if (pending.length > 0) conn.sendEvent('term.data', { id, data: pending.join('') })
}

function err(code: string, message: string): ResponseError {
  return { code, message }
}

function str(p: Record<string, unknown>, key: string): string {
  const v = p[key]

  if (typeof v !== 'string') throw new RpcError(ErrorCodes.BadRequest, `${key} must be a string`)

  return v
}

/** A reader that also takes an absent (undefined or null) parameter as undefined. */
function opt<T>(
  p: Record<string, unknown>,
  key: string,
  read: (p: Record<string, unknown>, key: string) => T
): T | undefined {
  return p[key] === undefined || p[key] === null ? undefined : read(p, key)
}

function optString(p: Record<string, unknown>, key: string): string | undefined {
  return opt(p, key, str)
}

function optStringArray(p: Record<string, unknown>, key: string): string[] | undefined {
  return opt(p, key, (q, k) => {
    const v = q[k]

    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
      throw new RpcError(ErrorCodes.BadRequest, `${k} must be an array of strings`)
    }

    return v
  })
}

function optBool(p: Record<string, unknown>, key: string): boolean | undefined {
  return opt(p, key, (q, k) => {
    const v = q[k]

    if (typeof v !== 'boolean') throw new RpcError(ErrorCodes.BadRequest, `${k} must be a boolean`)

    return v
  })
}

function optNumber(p: Record<string, unknown>, key: string): number | undefined {
  return opt(p, key, (q, k) => {
    const v = q[k]

    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new RpcError(ErrorCodes.BadRequest, `${k} must be a number`)
    }

    return v
  })
}

function num(p: Record<string, unknown>, key: string): number {
  const v = p[key]

  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) {
    throw new RpcError(ErrorCodes.BadRequest, `${key} must be a positive number`)
  }

  return v
}
