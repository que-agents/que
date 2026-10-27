// `que usage`: the newest Claude plan usage reading any session reported.
import type { Command } from 'commander'
import { formatUsage } from '../shared/usage'
import { printJson, withClient, workspaceNameOf } from './common'

export function registerUsageCommand(program: Command): void {
  program
    .command('usage')
    .description(
      "Claude plan usage: the five-hour and weekly windows, from the sessions' status line"
    )
    .option('--json', 'print JSON (null before the first reading)')
    .action((opts: { json?: boolean }) =>
      withClient(async (c) => {
        const usage = await c.request('usage.get')

        if (opts.json) return printJson(usage)
        const name = await workspaceNameOf(c, usage?.workspaceId)

        for (const line of formatUsage(usage, Date.now(), name)) console.log(line)
      })
    )
}
