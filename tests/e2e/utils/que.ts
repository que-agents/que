// The real `que` CLI against a test's QUE_HOME: seeds state and asserts daemon
// state with no window in the way.
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT, testEnv } from './app'

export function que(queHome: string, ...args: string[]): string {
  return execFileSync(process.execPath, [join(ROOT, 'out/cli/index.js'), ...args], {
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
  const r = spawnSync(process.execPath, [join(ROOT, 'out/cli/index.js'), ...args], {
    env: testEnv(queHome),
    encoding: 'utf8'
  })

  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}
