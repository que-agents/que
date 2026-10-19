// `que daemon upgrade`: hands every terminal from the running daemon to the
// daemon bundle of this que (normally the newly installed app's), which then
// serves the socket. Nothing running in a terminal notices.
import type { Command } from 'commander'
import { DaemonClient, DaemonError, resolveDaemonScript, resolveRuntime } from '../shared/client'
import { quePaths, type QuePaths } from '../shared/paths'
import { delay } from '../shared/process'
import type { HandoffResult } from '../shared/protocol'

interface UpgradeOptions {
  script?: string
  runtime?: string
}

export function registerUpgradeCommand(daemon: Command): void {
  daemon
    .command('upgrade')
    .description('hand every terminal to the daemon of this que, without ending any')
    .option('--script <path>', 'daemon bundle to start (default: the one next to this CLI)')
    .option('--runtime <path>', 'program that runs it as Node (default: the one of this que)')
    .action((opts: UpgradeOptions) => upgrade(opts))
}

async function upgrade(opts: UpgradeOptions): Promise<void> {
  const paths = quePaths()
  const c = await DaemonClient.tryConnect(paths)

  if (!c) {
    console.error('que: daemon is not running (start it with `que daemon start`)')
    process.exitCode = 1

    return
  }

  let result: HandoffResult | null = null
  let oldPid: number

  try {
    oldPid = (await c.request('daemon.ping')).pid
    result = await c
      .request('daemon.handoff', {
        script: opts.script ?? resolveDaemonScript(),
        runtime: opts.runtime ?? resolveRuntime()
      })
      .catch((err: Error) => {
        // The old daemon may exit before its answer arrives; the new pid tells.
        if (err instanceof DaemonError && err.code === 'disconnected') return null

        throw err
      })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`que: the handoff failed: ${msg}`)
    console.error(
      'the daemon keeps running with every terminal; `que daemon restart` restarts it instead, ending them'
    )
    process.exitCode = 1

    return
  } finally {
    c.close()
  }

  const next = await newDaemon(paths, oldPid, 10_000)

  if (!next) {
    console.error(`que: no new daemon answered after the handoff (see ${paths.daemonLog})`)
    process.exitCode = 1

    return
  }

  const carried = result?.terminals ?? next.terminals
  console.log(
    `daemon upgraded: pid ${oldPid} → ${next.pid}, ${carried} terminal${carried === 1 ? '' : 's'} carried over`
  )
}

/** Polls the socket until a daemon other than `oldPid` answers; null after `timeoutMs`. */
async function newDaemon(
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
