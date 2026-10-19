// `que daemon upgrade`: hands every terminal from the running daemon to the
// daemon bundle of this que (normally the newly installed app's), which then
// serves the socket. Nothing running in a terminal notices.
import type { Command } from 'commander'
import { DaemonClient } from '../shared/client'
import { plural } from '../shared/format'
import { quePaths } from '../shared/paths'
import { handOffDaemon, handOffFailedText, type HandOffOptions } from '../shared/upgrade'

export function registerUpgradeCommand(daemon: Command): void {
  daemon
    .command('upgrade')
    .description('hand every terminal to the daemon of this que, without ending any')
    .option('--script <path>', 'daemon bundle to start (default: the one next to this CLI)')
    .option('--runtime <path>', 'program that runs it as Node (default: the one of this que)')
    .action((opts: HandOffOptions) => upgrade(opts))
}

async function upgrade(opts: HandOffOptions): Promise<void> {
  const paths = quePaths()
  const c = await DaemonClient.tryConnect(paths)

  if (!c) {
    console.error('que: daemon is not running (start it with `que daemon start`)')
    process.exitCode = 1

    return
  }

  const outcome = await handOffDaemon(c, paths, opts).finally(() => c.close())

  if (!outcome.ok) {
    console.error(`que: ${handOffFailedText(outcome, paths)}`)
    process.exitCode = 1

    return
  }

  const { oldPid, pid, terminals } = outcome
  console.log(
    `daemon upgraded: pid ${oldPid} → ${pid}, ${plural(terminals, 'terminal')} carried over`
  )
}
