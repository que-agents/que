// DaemonClient: talks to the que daemon over its unix socket. Shared by the
// Electron main process, the CLI and scripts; must not depend on native modules.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import { daemonScriptFrom, runtimeFrom } from './packaged'
import { ensureDirs, quePaths, type QuePaths } from './paths'
import {
  MessageDecoder,
  encode,
  isEvent,
  type EventName,
  type Events,
  type MethodName,
  type ParamsOf,
  type ResponseError,
  type ResultOf,
  type ServerMessage
} from './protocol'

export class DaemonError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'DaemonError'
  }
}

export interface StartOptions {
  paths?: QuePaths
  /** Program that runs the daemon script as Node. Defaults to the Electron binary. */
  runtime?: string
  /** Path to the bundled daemon entry (out/daemon/index.js). */
  daemonScript?: string
  /** How long to wait for the daemon to answer daemon.ping. Default 5000 ms. */
  timeoutMs?: number
  log?: (msg: string) => void
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }
type Handler = (data: never) => void

export class DaemonClient {
  private socket: net.Socket | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private handlers = new Map<string, Set<Handler>>()
  private closeHandlers = new Set<() => void>()

  constructor(readonly socketPath: string = quePaths().socket) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.socketPath)
      const onError = (err: Error): void => {
        socket.destroy()
        reject(err)
      }
      socket.once('error', onError)
      socket.once('connect', () => {
        socket.off('error', onError)
        socket.setNoDelay(true)
        this.socket = socket
        this.wire(socket)
        resolve()
      })
    })
  }

  private wire(socket: net.Socket): void {
    const decoder = new MessageDecoder<ServerMessage>()
    socket.on('data', (chunk) => {
      for (const msg of decoder.push(chunk)) this.receive(msg)
    })
    socket.on('error', () => {
      // 'close' follows and handles cleanup.
    })
    socket.on('close', () => {
      this.socket = null
      const err = new DaemonError('disconnected', 'daemon connection closed')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      for (const h of this.closeHandlers) h()
    })
  }

  private receive(msg: ServerMessage): void {
    if (isEvent(msg)) {
      const set = this.handlers.get(msg.event)
      if (set) for (const h of set) (h as (d: unknown) => void)(msg.data)
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if ('error' in msg) {
      const e = msg.error as ResponseError
      p.reject(new DaemonError(e.code, e.message))
    } else {
      p.resolve(msg.result)
    }
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  request<M extends MethodName>(method: M, params?: ParamsOf<M>): Promise<ResultOf<M>> {
    const socket = this.socket
    if (!socket || socket.destroyed) {
      return Promise.reject(new DaemonError('disconnected', 'not connected to daemon'))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      socket.write(encode({ id, method, params }))
    })
  }

  on<E extends EventName>(event: E, handler: (data: Events[E]) => void): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler as Handler)
    return () => set.delete(handler as Handler)
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  close(): void {
    this.socket?.end()
    this.socket?.destroy()
    this.socket = null
  }

  /**
   * Connects to the running daemon, starting one (detached) if the socket is
   * missing or stale, then waits until it answers daemon.ping.
   */
  static async connectOrStart(opts: StartOptions = {}): Promise<DaemonClient> {
    const paths = ensureDirs(opts.paths ?? quePaths())
    const log = opts.log ?? (() => {})
    const first = new DaemonClient(paths.socket)
    try {
      await first.connect()
      return first
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ECONNREFUSED' && fs.existsSync(paths.socket)) {
        log(`removing stale socket ${paths.socket}`)
        fs.rmSync(paths.socket, { force: true })
      } else if (code !== 'ENOENT' && code !== 'ECONNREFUSED') {
        throw err
      }
    }

    startDaemon(paths, opts)
    log('started daemon, waiting for ping')

    const deadline = Date.now() + (opts.timeoutMs ?? 5000)
    let lastErr: unknown = null
    while (Date.now() < deadline) {
      const c = new DaemonClient(paths.socket)
      try {
        await c.connect()
        await withTimeout(c.request('daemon.ping'), 1000)
        return c
      } catch (err) {
        lastErr = err
        c.close()
        await delay(100)
      }
    }
    throw new DaemonError(
      'start_timeout',
      `daemon did not answer within ${opts.timeoutMs ?? 5000} ms (see ${paths.daemonLog}): ${String(lastErr)}`
    )
  }

  /** Connects only if a daemon is already running; resolves null otherwise. */
  static async tryConnect(paths: QuePaths = quePaths()): Promise<DaemonClient | null> {
    const c = new DaemonClient(paths.socket)
    try {
      await c.connect()
      return c
    } catch {
      return null
    }
  }
}

/**
 * The Electron binary, used as a Node runtime for the daemon: the current
 * executable inside Electron (the app, or a bundle the app binary runs as
 * Node), the app binary when this bundle sits in a packaged que.app, else the
 * binary of the `electron` dev dependency (CLI and scripts under plain Node).
 */
export function resolveRuntime(): string {
  return runtimeFrom(__dirname, process) ?? (require('electron') as unknown as string)
}

/** que.app/Contents/Resources/daemon/index.js when packaged, else out/daemon/index.js. */
export function resolveDaemonScript(): string {
  return daemonScriptFrom(__dirname)
}

function startDaemon(paths: QuePaths, opts: StartOptions): void {
  const runtime = opts.runtime ?? resolveRuntime()
  const script = opts.daemonScript ?? resolveDaemonScript()
  if (!fs.existsSync(script)) {
    throw new DaemonError(
      'no_daemon_script',
      `daemon script not found at ${script}; run npm run build:node`
    )
  }
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  // Dev-server and app-specific variables must not leak into user shells.
  delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_ENABLE_LOGGING
  env.ELECTRON_RUN_AS_NODE = '1'
  env.QUE_HOME = paths.home

  const logFd = fs.openSync(paths.daemonLog, 'a')
  try {
    const child = spawn(runtime, [script], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env,
      cwd: os.homedir()
    })
    child.unref()
  } finally {
    fs.closeSync(logFd)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}
