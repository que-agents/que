import { randomUUID } from 'node:crypto'
import os from 'node:os'
import * as pty from 'node-pty'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { TermCreateParams, TermInfo, TermSnapshotResult } from '../shared/protocol'

const SCROLLBACK = 10000

export interface ExitInfo {
  exitCode: number
  signal?: number
}

/** One PTY plus a headless xterm mirror of everything it has printed. */
export class HostedTerminal {
  readonly id: string
  readonly name: string
  readonly cwd: string
  readonly createdAt: string
  readonly proc: pty.IPty
  readonly mirror: HeadlessTerminal
  private serializer: SerializeAddon
  alive = true
  cols: number
  rows: number

  constructor(
    opts: TermCreateParams,
    onData: (data: string) => void,
    onExit: (e: ExitInfo) => void
  ) {
    this.id = randomUUID()
    this.cols = Math.max(1, Math.floor(opts.cols) || 80)
    this.rows = Math.max(1, Math.floor(opts.rows) || 24)
    this.cwd = opts.cwd || os.homedir()
    this.createdAt = new Date().toISOString()

    const file = opts.file ?? (process.env.SHELL || '/bin/zsh')
    // A login shell picks up the user's profile, as a terminal app would.
    const args = opts.args ?? (opts.file ? [] : ['-l'])
    this.name = opts.name || file.split('/').pop() || 'shell'

    this.mirror = new HeadlessTerminal({
      cols: this.cols,
      rows: this.rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true
    })
    this.serializer = new SerializeAddon()
    // The serialize addon is typed against the browser Terminal; the headless
    // terminal implements the same public surface it uses.
    this.mirror.loadAddon(
      this.serializer as unknown as Parameters<HeadlessTerminal['loadAddon']>[0]
    )

    this.proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env: spawnEnv()
    })
    this.proc.onData((data) => {
      this.mirror.write(data)
      onData(data)
    })
    this.proc.onExit(({ exitCode, signal }) => {
      this.alive = false
      onExit({ exitCode, signal })
    })
  }

  write(data: string): void {
    if (this.alive) this.proc.write(data)
  }

  resize(cols: number, rows: number): void {
    cols = Math.floor(cols)
    rows = Math.floor(rows)
    if (!(cols >= 1 && rows >= 1)) return
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    this.mirror.resize(cols, rows)
    if (!this.alive) return
    try {
      this.proc.resize(cols, rows)
    } catch {
      // The process may have exited between the check and the resize.
    }
  }

  /**
   * Serialized screen + scrollback. The mirror's write queue is drained first
   * so the snapshot reflects every byte received before this call, and no
   * byte received after it (serialization runs inside the write callback,
   * before xterm processes any later chunk).
   */
  snapshot(): Promise<TermSnapshotResult> {
    return this.atBoundary(() => ({ serialized: this.serialize(), text: this.text() }))
  }

  /** Same boundary guarantee as snapshot(), serialized form only. */
  serializeNow(): Promise<string> {
    return this.atBoundary(() => this.serialize())
  }

  private atBoundary<T>(fn: () => T): Promise<T> {
    return new Promise((resolve) => this.mirror.write('', () => resolve(fn())))
  }

  private serialize(): string {
    return this.serializer.serialize({ scrollback: SCROLLBACK })
  }

  private text(): string {
    const buf = this.mirror.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buf.length; i++) {
      lines.push(buf.getLine(i)?.translateToString(true) ?? '')
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines.join('\n')
  }

  kill(): void {
    if (this.alive) {
      try {
        this.proc.kill()
      } catch {
        // Already gone.
      }
    }
    this.alive = false
  }

  dispose(): void {
    this.kill()
    this.mirror.dispose()
  }

  info(): TermInfo {
    return {
      id: this.id,
      name: this.name,
      cwd: this.cwd,
      cols: this.cols,
      rows: this.rows,
      pid: this.proc.pid,
      alive: this.alive,
      createdAt: this.createdAt
    }
  }
}

export function spawnEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v
  }
  delete env.ELECTRON_RUN_AS_NODE
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}

type DataListener = (id: string, data: string) => void
type ExitListener = (id: string, info: ExitInfo) => void

/** Owns every terminal in the daemon; terminals outlive client connections. */
export class PtyHost {
  private terms = new Map<string, HostedTerminal>()
  private dataListeners = new Set<DataListener>()
  private exitListeners = new Set<ExitListener>()

  create(opts: TermCreateParams): HostedTerminal {
    let id = ''
    const t = new HostedTerminal(
      opts,
      (data) => {
        for (const l of this.dataListeners) l(id, data)
      },
      (info) => {
        for (const l of this.exitListeners) l(id, info)
      }
    )
    id = t.id
    this.terms.set(id, t)
    return t
  }

  get(id: string): HostedTerminal | undefined {
    return this.terms.get(id)
  }

  list(): HostedTerminal[] {
    return [...this.terms.values()]
  }

  /** Kills the process and forgets the terminal. Returns false if unknown. */
  kill(id: string): boolean {
    const t = this.terms.get(id)
    if (!t) return false
    this.terms.delete(id)
    t.dispose()
    return true
  }

  killAll(): void {
    for (const id of [...this.terms.keys()]) this.kill(id)
  }

  onData(l: DataListener): () => void {
    this.dataListeners.add(l)
    return () => this.dataListeners.delete(l)
  }

  onExit(l: ExitListener): () => void {
    this.exitListeners.add(l)
    return () => this.exitListeners.delete(l)
  }
}
