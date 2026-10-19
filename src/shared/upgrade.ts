// Updating the daemon in place: the running daemon hands every live terminal
// to a successor started from the given bundle (daemon.handoff), and the
// caller waits until a daemon with another pid answers on the socket. Both
// `que daemon upgrade` and the app's Update button go through here. A failure
// is an answer, not a throw: the old daemon still serves and nothing changed.
import { DaemonClient, DaemonError } from './client'
import { errorMessage } from './errors.decode'
import type { QuePaths } from './paths'
import { delay } from './process'
import { ErrorCodes } from './protocol'

export interface HandOffOptions {
  /** The daemon bundle the successor runs. */
  script: string
  /** The program that runs it as Node. */
  runtime: string
  /** How long to wait for the successor to answer after the handoff. Default 10 s. */
  timeoutMs?: number
}

export type HandOffOutcome =
  | {
      ok: true
      /** The daemon that handed over. */
      oldPid: number
      /** The successor, now serving the socket. */
      pid: number
      /** Live terminals it serves. */
      terminals: number
    }
  | {
      ok: false
      /** Why, as a short sentence: the daemon's own message when it refused. */
      reason: string
      /** No successor answered in time (the handoff itself was not refused). */
      timedOut: boolean
    }

/** What a daemon from before the handoff answers to it, in words. */
export const TOO_OLD_TO_HAND_OFF = 'the running service is too old to update in place'

/** Asks the daemon on `c` to hand over, then waits for its successor on `paths`. */
export async function handOffDaemon(
  c: DaemonClient,
  paths: QuePaths,
  opts: HandOffOptions
): Promise<HandOffOutcome> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  let oldPid: number
  let carried: number | null = null

  try {
    oldPid = (await c.request('daemon.ping')).pid

    const result = await c
      .request('daemon.handoff', { script: opts.script, runtime: opts.runtime })
      .catch((err: Error) => {
        // The old daemon may exit before its answer arrives; the new pid tells.
        if (err instanceof DaemonError && err.code === 'disconnected') return null

        throw err
      })

    carried = result?.terminals ?? null
  } catch (err) {
    const tooOld = err instanceof DaemonError && err.code === ErrorCodes.UnknownMethod

    return { ok: false, reason: tooOld ? TOO_OLD_TO_HAND_OFF : errorMessage(err), timedOut: false }
  }

  const next = await successor(paths, oldPid, timeoutMs)

  if (!next) {
    return {
      ok: false,
      reason: `no new service answered within ${Math.round(timeoutMs / 1000)} seconds`,
      timedOut: true
    }
  }

  return { ok: true, oldPid, pid: next.pid, terminals: carried ?? next.terminals }
}

/** Polls the socket until a daemon other than `oldPid` answers; null after `timeoutMs`. */
async function successor(
  paths: QuePaths,
  oldPid: number,
  timeoutMs: number
): Promise<{ pid: number; terminals: number } | null> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const c = await DaemonClient.tryConnect(paths)

    if (c) {
      try {
        const { pid } = await c.request('daemon.ping')

        if (pid !== oldPid) {
          const terms = await c.request('term.list')

          return { pid, terminals: terms.filter((t) => t.alive).length }
        }
      } catch {
        // Between daemons; try again.
      } finally {
        c.close()
      }
    }

    await delay(100)
  }

  return null
}
