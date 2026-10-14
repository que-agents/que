import { randomUUID } from 'node:crypto'
import os from 'node:os'
import * as pty from 'node-pty'

export interface SpawnOptions {
  cwd?: string
  cols: number
  rows: number
  /** Override the program to run. Defaults to the user's login shell. */
  file?: string
  args?: string[]
}

export interface ExitInfo {
  exitCode: number
  signal?: number
}

type DataListener = (id: string, data: string) => void
type ExitListener = (id: string, info: ExitInfo) => void

function defaultShell(): string {
  return process.env.SHELL || '/bin/zsh'
}

/** Owns every PTY process for the app; keyed by an opaque id. */
export class PtyManager {
  private sessions = new Map<string, pty.IPty>()
  private dataListeners = new Set<DataListener>()
  private exitListeners = new Set<ExitListener>()

  spawn(opts: SpawnOptions): string {
    const id = randomUUID()
    const file = opts.file ?? defaultShell()
    // A login shell picks up the user's profile, as a terminal app would.
    const args = opts.args ?? ['-l']
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v
    }
    delete env.ELECTRON_RUN_AS_NODE
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'

    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: Math.max(1, opts.cols),
      rows: Math.max(1, opts.rows),
      cwd: opts.cwd || os.homedir(),
      env
    })
    this.sessions.set(id, proc)
    proc.onData((data) => {
      for (const l of this.dataListeners) l(id, data)
    })
    proc.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id)
      for (const l of this.exitListeners) l(id, { exitCode, signal })
    })
    return id
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols < 1 || rows < 1) return
    try {
      this.sessions.get(id)?.resize(cols, rows)
    } catch {
      // The process may have exited between the lookup and the resize.
    }
  }

  kill(id: string): void {
    const proc = this.sessions.get(id)
    if (!proc) return
    this.sessions.delete(id)
    try {
      proc.kill()
    } catch {
      // Already gone.
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  onData(listener: DataListener): () => void {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }
}
