// One way to run a subprocess for the daemon and the CLI: execFile with an
// argv (never a shell string), stdin closed, and a result instead of a throw.
// Each tool keeps its own small wrapper for its env, limits and error text.
// Node-only: the renderer never imports this.
import { type ExecFileOptions, execFile } from 'node:child_process'
import { errorCode } from './errors.decode'

export interface RunOptions {
  cwd?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  /** Bytes of stdout or stderr before the run is killed; execFile's default otherwise. */
  maxBuffer?: number
}

export interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
  /** The errno a failed start carries (`ENOENT` for a missing binary), else null. */
  code: string | null
  /** The failure's message; empty when the run succeeded. */
  error: string
}

/** Runs `file args`; never throws. */
export function run(file: string, args: readonly string[], o: RunOptions = {}): Promise<RunResult> {
  const options: ExecFileOptions = {}

  if (o.cwd !== undefined) options.cwd = o.cwd

  if (o.timeoutMs !== undefined) options.timeout = o.timeoutMs

  if (o.env !== undefined) options.env = o.env

  if (o.signal !== undefined) options.signal = o.signal

  if (o.maxBuffer !== undefined) options.maxBuffer = o.maxBuffer

  return new Promise((resolve) => {
    execFile(file, args, { ...options, encoding: 'utf8' }, (err, stdout, stderr) =>
      resolve({
        ok: !err,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        code: errorCode(err),
        error: err ? err.message : ''
      })
    ).stdin?.end()
  })
}

/** The first line of `text` (trimmed as a whole), or `fallback` when there is none. */
export function firstLine(text: string, fallback = ''): string {
  return text.trim().split('\n')[0] || fallback
}
