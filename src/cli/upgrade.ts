// `que daemon upgrade`: hands every terminal from the running daemon to the
// daemon bundle of this que (normally the newly installed app's), which then
// serves the socket. Nothing running in a terminal notices.
import type { Command } from 'commander'
import { DaemonClient, resolveDaemonScript, resolveRuntime } from '../shared/client'
import { quePaths } from '../shared/paths'
import { handOffDaemon } from '../shared/upgrade'

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

  const outcome = await handOffDaemon(c, paths, {
    script: opts.script ?? resolveDaemonScript(),
    runtime: opts.runtime ?? resolveRuntime()
  }).finally(() => c.close())

  if (!outcome.ok) {
    if (outcome.timedOut) {
      console.error(`que: ${outcome.reason} after the handoff (see ${paths.daemonLog})`)
    } else {
      console.error(`que: the handoff failed: ${outcome.reason}`)
      console.error(
        'the daemon keeps running with every terminal; `que daemon restart` restarts it instead, ending them'
      )
    }

    process.exitCode = 1

    return
  }

  const { oldPid, pid, terminals } = outcome
  console.log(
    `daemon upgraded: pid ${oldPid} → ${pid}, ${terminals} terminal${terminals === 1 ? '' : 's'} carried over`
  )
}
