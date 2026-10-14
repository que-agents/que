import fs from 'node:fs'
import net from 'node:net'
import {
  ErrorCodes,
  MessageDecoder,
  encode,
  type EventName,
  type Events,
  type PingResult,
  type Request,
  type ResponseError
} from '../shared/protocol'
import { loadConfig, type UserConfig, defaultConfig } from '../shared/config'
import { ensureDirs, quePaths, type QuePaths } from '../shared/paths'
import type { HookEvent, TermCreateParams } from '../shared/protocol'
import { RpcError } from './errors'
import type { HostedTerminal, PtyHost, TermExtra } from './pty-host'
import { StatusService } from './status'
import { Store } from './store'
import { WorkspaceManager, workspaceTerminalEnv } from './workspaces'
import { defaultCliScript, installWrapper, resolveNode } from './wrapper'

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
}

interface Subscription {
  /** Live data buffered while an attach snapshot is being taken. */
  pending: string[] | null
}

/** Work to run after a response is written (e.g. flushing buffered data). */
type AfterSend = (fn: () => void) => void

class Connection {
  readonly subs = new Map<string, Subscription>()
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

export class DaemonServer {
  private server: net.Server | null = null
  private conns = new Set<Connection>()
  private unsubs: Array<() => void> = []
  private socketPath = ''
  private closed = false
  /** Workspace of each workspace terminal, kept past the terminal's removal. */
  private termWorkspace = new Map<string, string>()
  readonly startedAt: string
  readonly paths: QuePaths
  readonly store: Store
  readonly status: StatusService
  readonly workspaces: WorkspaceManager

  constructor(private opts: ServerOptions) {
    this.startedAt = opts.startedAt ?? new Date().toISOString()
    const { host } = opts
    this.paths = ensureDirs(opts.paths ?? quePaths())
    this.store = new Store(this.paths.db)
    const emit = this.broadcast.bind(this) as DaemonServer['broadcast']
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
      log: (m) => this.log(m)
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
        this.broadcast('term.exit', { id, exitCode: info.exitCode, signal: info.signal })
        const wsId = this.termWorkspace.get(id)
        if (wsId) {
          this.termWorkspace.delete(id)
          const live = host.list().some((t) => t.alive && t.workspaceId === wsId)
          if (!live) this.status.apply(wsId, { kind: 'terminal_exit' })
        }
      })
    )
  }

  private configOrDefault(): UserConfig {
    const r = loadConfig({ queHome: this.paths.home })
    if (r.ok) return r.config
    return defaultConfig({ queHome: this.paths.home })
  }

  private createTerminal(params: TermCreateParams, extra?: TermExtra): HostedTerminal {
    const t = this.opts.host.create(params, extra)
    if (extra?.workspaceId) this.termWorkspace.set(t.id, extra.workspaceId)
    this.log(`term ${t.id} created pid=${t.proc.pid} cwd=${t.cwd}`)
    this.broadcast('term.created', { id: t.id })
    return t
  }

  private killTerminal(id: string): boolean {
    if (!this.opts.host.kill(id)) return false
    this.log(`term ${id} killed`)
    for (const c of this.conns) c.subs.delete(id)
    this.broadcast('term.killed', { id })
    return true
  }

  private killWorkspaceTerminals(workspaceId: string): void {
    for (const t of this.opts.host.list()) {
      if (t.workspaceId === workspaceId) {
        this.termWorkspace.delete(t.id)
        this.killTerminal(t.id)
      }
    }
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
          this.conns.delete(conn)
        })
      })
      server.once('error', reject)
      server.listen(socketPath, () => {
        server.off('error', reject)
        this.socketPath = socketPath
        try {
          installWrapper({
            paths: this.paths,
            nodePath: resolveNode(),
            cliScript: this.opts.cliScript ?? defaultCliScript()
          })
        } catch (err) {
          this.log(`installing the hooks wrapper failed: ${(err as Error).message}`)
        }
        this.status.start()
        server.on('error', (err) => this.log(`server error: ${err.message}`))
        try {
          fs.chmodSync(socketPath, 0o600)
        } catch (err) {
          this.log(`chmod socket failed: ${(err as Error).message}`)
        }
        this.server = server
        resolve()
      })
    })
  }

  /** Stops accepting connections and drops existing ones. Does not kill PTYs. */
  close(): Promise<void> {
    for (const u of this.unsubs) u()
    this.unsubs = []
    if (!this.closed) {
      this.closed = true
      this.status.stop()
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

  broadcast<E extends EventName>(event: E, data: Events[E]): void {
    for (const c of this.conns) c.sendEvent(event, data)
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
        e instanceof RpcError
          ? err(e.code, e.message)
          : err(ErrorCodes.Internal, e instanceof Error ? e.message : String(e))
      if (!(e instanceof RpcError)) this.log(`${req.method} failed: ${error.message}`)
      conn.send({ id: req.id, error })
    }
  }

  private async handle(
    conn: Connection,
    method: string,
    p: Record<string, unknown>,
    afterSend: AfterSend
  ): Promise<unknown> {
    const { host } = this.opts
    switch (method) {
      case 'daemon.ping': {
        const r: PingResult = {
          version: this.opts.version,
          pid: process.pid,
          startedAt: this.startedAt,
          nodeVersion: process.version
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
        return { id: t.id }
      }
      case 'term.list': {
        const workspaceId = optString(p, 'workspaceId')
        return host
          .list()
          .filter((t) => !workspaceId || t.workspaceId === workspaceId)
          .map((t) => t.info())
      }
      case 'term.attach': {
        const t = term(host, p)
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
        term(host, p).write(str(p, 'data'))
        return { ok: true }
      }
      case 'term.resize': {
        term(host, p).resize(num(p, 'cols'), num(p, 'rows'))
        return { ok: true }
      }
      case 'term.kill': {
        const id = str(p, 'id')
        if (!this.killTerminal(id)) throw new RpcError(ErrorCodes.NotFound, `no terminal ${id}`)
        return { ok: true }
      }
      case 'term.snapshot':
        return term(host, p).snapshot()
      case 'project.add':
        return this.workspaces.addProject({ path: str(p, 'path'), name: optString(p, 'name') })
      case 'project.list':
        return this.workspaces.listProjects()
      case 'project.remove':
        await this.workspaces.removeProject(str(p, 'id'), optBool(p, 'force'))
        return { ok: true }
      case 'workspace.create':
        return this.workspaces.create({
          projectId: str(p, 'projectId'),
          name: str(p, 'name'),
          baseRef: optString(p, 'baseRef'),
          branch: optString(p, 'branch')
        })
      case 'workspace.list':
        return this.workspaces.list(optString(p, 'projectId'))
      case 'workspace.get':
        return this.workspaces.get(str(p, 'id'))
      case 'workspace.remove':
        await this.workspaces.remove({ id: str(p, 'id'), deleteBranch: optBool(p, 'deleteBranch') })
        return { ok: true }
      case 'workspace.openTerminal': {
        const ws = this.workspaces.get(str(p, 'id'))
        const t = this.createTerminal(
          { cwd: ws.path, cols: num(p, 'cols'), rows: num(p, 'rows'), name: ws.name },
          { workspaceId: ws.id, env: workspaceTerminalEnv(ws, this.paths, this.socketPath) }
        )
        return { id: t.id }
      }
      case 'hook.event': {
        const ws = this.workspaces.get(str(p, 'workspaceId'))
        const payload = p.payload
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
          throw new RpcError(ErrorCodes.BadRequest, 'payload must be an object')
        }
        this.status.hook(ws.id, payload as HookEvent)
        return { ok: true }
      }
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

function optString(p: Record<string, unknown>, key: string): string | undefined {
  return p[key] === undefined || p[key] === null ? undefined : str(p, key)
}

function optStringArray(p: Record<string, unknown>, key: string): string[] | undefined {
  const v = p[key]
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new RpcError(ErrorCodes.BadRequest, `${key} must be an array of strings`)
  }
  return v
}

function optBool(p: Record<string, unknown>, key: string): boolean | undefined {
  const v = p[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') throw new RpcError(ErrorCodes.BadRequest, `${key} must be a boolean`)
  return v
}

function num(p: Record<string, unknown>, key: string): number {
  const v = p[key]
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) {
    throw new RpcError(ErrorCodes.BadRequest, `${key} must be a positive number`)
  }
  return v
}

function term(host: PtyHost, p: Record<string, unknown>) {
  const id = str(p, 'id')
  const t = host.get(id)
  if (!t) throw new RpcError(ErrorCodes.NotFound, `no terminal ${id}`)
  return t
}
