// Runs the real `que` CLI (bundled from source) as a subprocess.
import { execFile } from 'node:child_process'
import { bundleEntry } from './bundle'

export interface CliResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Runs `que <args>` with the current process.env (so a stubbed QUE_HOME and
 * PATH apply). Async on purpose: an in-process daemon must keep serving the
 * socket while the CLI talks to it.
 */
export function runCli(...args: string[]): Promise<CliResult> {
  const cli = bundleEntry('src/cli/index.ts')
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, ...args],
      { env: { ...process.env }, encoding: 'utf8', timeout: 15_000 },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, stdout, stderr })
      }
    )
  })
}
