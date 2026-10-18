// The real `que` CLI against a test's QUE_HOME: seeds state and asserts daemon
// state with no window in the way.
import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { REPO_ROOT } from '../../../src/testing/fakes'
import { testEnv } from './app'

export function que(queHome: string, ...args: string[]): string {
  return execFileSync(process.execPath, [join(REPO_ROOT, 'out/cli/index.js'), ...args], {
    env: testEnv(queHome),
    encoding: 'utf8'
  })
}

export function queJson<T>(queHome: string, ...args: string[]): T {
  return JSON.parse(que(queHome, ...args)) as T
}

/** Runs `que` without throwing on failure: the exit code and both streams. */
export function queResult(
  queHome: string,
  ...args: string[]
): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [join(REPO_ROOT, 'out/cli/index.js'), ...args], {
    env: testEnv(queHome),
    encoding: 'utf8'
  })

  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

/**
 * Runs `que` in the background, so the test can watch the window while it runs:
 * the exit code and both streams once it ends.
 */
export function queAsync(
  queHome: string,
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [join(REPO_ROOT, 'out/cli/index.js'), ...args],
      { env: testEnv(queHome), encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, stdout, stderr })
      }
    )
  })
}
