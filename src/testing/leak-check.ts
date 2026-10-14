// Leak check for daemon integration tests: every terminal process a test
// created must be gone once the harness has torn the daemon down.
import type { TermCreateParams } from '@shared/protocol'
import { type HostedTerminal, PtyHost, type TermExtra } from '@daemon/pty-host'

/** True while `pid` exists (signal 0 only checks; it sends nothing). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The real PtyHost, recording the pid of every terminal it spawns. */
export class LeakCheckedPtyHost extends PtyHost {
  readonly pids = new Set<number>()

  override create(opts: TermCreateParams, extra?: TermExtra): HostedTerminal {
    const t = super.create(opts, extra)
    this.pids.add(t.proc.pid)
    return t
  }
}

/**
 * Waits up to `timeoutMs` for every pid to exit. Any survivor is SIGKILLed so
 * it cannot outlive the run, and the call throws so the test fails.
 */
export async function assertPidsGone(pids: Iterable<number>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let alive = [...pids].filter(pidAlive)
  while (alive.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25))
    alive = alive.filter(pidAlive)
  }
  if (alive.length === 0) return
  for (const pid of alive) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Exited between the check and the kill.
    }
  }
  throw new Error(`leaked terminal processes still alive after teardown: ${alive.join(', ')}`)
}
