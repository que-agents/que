// Small process helpers for the daemon, the CLI and the test harnesses:
// whether a pid exists, a promise-based delay, and waiting for a pid to exit.
import { errorCode } from './errors.decode'

/** True while `pid` exists (signal 0 only checks); EPERM means it exists but is not ours. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (err) {
    return errorCode(err) === 'EPERM'
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Polls until `pid` has exited or `timeoutMs` passed; true when it is gone. */
export async function waitForExit(pid: number, timeoutMs: number, everyMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (pidAlive(pid)) {
    if (Date.now() >= deadline) return false
    await delay(everyMs)
  }

  return true
}
