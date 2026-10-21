// `que report`: the morning report, what the sessions did.
import type { Command } from 'commander'
import { formatUnlocks } from '../daemon/quiet-hours'
import { formatReport, parseSince } from '../daemon/report'
import { CliError, printJson, withClient } from './common'

export function registerReportCommand(program: Command): void {
  program
    .command('report')
    .description('the morning report: what the sessions did')
    .option('--since <when>', 'ISO time or a duration back from now (12h, 90m, 2d)')
    .option('--json', 'print JSON')
    .action((opts: { since?: string; json?: boolean }) =>
      withClient(async (c) => {
        const since = opts.since === undefined ? undefined : parseSince(opts.since, Date.now())

        if (since === null) throw new CliError(`invalid --since ${opts.since}`)
        const r = await c.request('report.get', since ? { since } : {})

        if (opts.json) return printJson(r)
        const unlocks = await c.request('quiet.log', { since: r.since })
        console.log(formatReport(r, formatUnlocks(unlocks, Date.now())))
      }, false)
    )
}
