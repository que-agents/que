// handOffDaemon against a daemon from before the handoff, which knows no such
// method (a stub on its own socket; the real daemon paths run through `que daemon
// upgrade` in tests/integration/handoff.test.ts), and the words of a failed hand-off.
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DaemonClient } from './client'
import { quePaths, type QuePaths } from './paths'
import { encode, MessageDecoder, type Request } from './protocol'
import { handOffDaemon, handOffFailedText, TOO_OLD_TO_HAND_OFF } from './upgrade'

let scratch: string
let paths: QuePaths
let homeBefore: string | undefined

beforeEach(() => {
  scratch = fs.mkdtempSync(join(os.tmpdir(), 'que-upgrade-'))
  homeBefore = process.env.QUE_HOME
  process.env.QUE_HOME = scratch
  paths = quePaths()
})

afterEach(() => {
  if (homeBefore === undefined) delete process.env.QUE_HOME
  else process.env.QUE_HOME = homeBefore
  fs.rmSync(scratch, { recursive: true, force: true })
})

/**
 * A daemon from before the handoff, on its own socket: it answers ping and
 * refuses every other method as unknown, as such a daemon does.
 */
async function olderDaemon(socket: string): Promise<net.Server> {
  const server = net.createServer((conn) => {
    const decoder = new MessageDecoder<Request>()
    conn.on('data', (chunk) => {
      for (const req of decoder.push(chunk)) {
        const answer =
          req.method === 'daemon.ping'
            ? { id: req.id, result: { ok: true, pid: 4242, version: '0.3.0' } }
            : {
                id: req.id,
                error: { code: 'unknown_method', message: `unknown method ${req.method}` }
              }

        conn.write(encode(answer))
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(socket, resolve))

  return server
}

describe('handOffDaemon', () => {
  it('answers ok: false, too old, when the running daemon has no handoff', async () => {
    const socket = join(scratch, 'old.sock')
    const server = await olderDaemon(socket)
    const c = new DaemonClient(socket)

    try {
      await c.connect()

      const outcome = await handOffDaemon(c, paths, {
        script: join(scratch, 'daemon.js'),
        runtime: process.execPath
      })

      expect(outcome).toEqual({ ok: false, reason: TOO_OLD_TO_HAND_OFF, timedOut: false })
    } finally {
      c.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('handOffFailedText', () => {
  it('says nothing changed and names the restart when the daemon refused', () => {
    const outcome = {
      ok: false as const,
      reason: 'the new daemon exited (code 3) while taking over the terminals',
      timedOut: false
    }

    expect(handOffFailedText(outcome, paths)).toBe(
      'the handoff failed: the new daemon exited (code 3) while taking over the terminals. Nothing changed: the previous build keeps serving every terminal, and que daemon restart would end them and start this build'
    )
  })

  it('points at the service log when no successor answered in time', () => {
    const outcome = {
      ok: false as const,
      reason: 'no new service answered within 10 seconds',
      timedOut: true
    }

    expect(handOffFailedText(outcome, paths)).toBe(
      `no new service answered within 10 seconds after the handoff; see the service log at ${paths.daemonLog}`
    )
  })
})
