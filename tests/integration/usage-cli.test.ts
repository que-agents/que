// `que usage` as a subprocess against an in-process daemon: the reading a
// session reported, as text and as JSON, and before there is one. The
// formatting rules themselves are in src/shared/usage.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hhmm } from '@shared/format'
import type { Usage } from '@shared/types'
import { formatWeekdayClock } from '@shared/usage'
import { runCli, runCliJson } from '../../src/testing/cli'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon

beforeEach(async () => {
  daemon = await startTestDaemon()
})

afterEach(async () => {
  await daemon.close()
})

/** A reading from a workspace's session: 42% of five hours, resetting in 2h 10m (and 30s, so the CLI's clock still reads 2h 10m). */
async function reportFromWorkspace(): Promise<Usage> {
  const project = await daemon.client.request('project.add', { path: makeTempRepo(daemon.home) })

  const ws = await daemon.client.request('workspace.create', {
    projectId: project.id,
    name: 'silver-gentle-pumpkin'
  })

  const now = Date.now()

  const usage: Usage = {
    fiveHour: { pct: 41.6, resetsAt: now + (2 * 60 + 10) * 60_000 + 30_000 },
    sevenDay: { pct: 18.2, resetsAt: now + 3 * 86_400_000 },
    at: now,
    workspaceId: ws.id
  }

  await daemon.client.request('usage.report', usage)

  return usage
}

describe('que usage', () => {
  it('prints both windows and the workspace whose session reported them', async () => {
    const usage = await reportFromWorkspace()

    const r = await runCli('usage')

    expect(r).toMatchObject({
      code: 0,
      stdout: [
        `5h  42%  resets ${hhmm(usage.fiveHour?.resetsAt ?? 0)} (in 2h 10m)`,
        `wk  18%  resets ${formatWeekdayClock(usage.sevenDay?.resetsAt ?? 0)}`,
        `as of ${hhmm(usage.at)} · silver-gentle-pumpkin`,
        ''
      ].join('\n')
    })
  }, 30_000)

  it('prints the reading as JSON with --json', async () => {
    const usage = await reportFromWorkspace()

    expect(await runCliJson<Usage>('usage', '--json')).toEqual(usage)
  }, 30_000)

  it('says there is no reading yet, and null as JSON', async () => {
    expect(await runCli('usage')).toMatchObject({ code: 0, stdout: 'no reading yet\n' })
    expect(await runCliJson<Usage | null>('usage', '--json')).toBeNull()
  }, 30_000)
})
