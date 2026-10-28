// Claude plan usage: the status line que passes each session (`que statusline`
// from hooks.json), run by the fake claude in a real workspace terminal, the
// report reaching the daemon, the user's own status line printing through,
// and the daemon keeping the newest reading: older ones ignored, windows
// dropped at their reset, the reading kept across a restart. Parsing the
// payload and choosing the user's status line are in the shared logic tests.
import fs from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Usage, Workspace } from '@shared/types'
import {
  recordEvents,
  runClaude,
  startTestDaemon,
  type TestDaemon,
  waitForStatus
} from '../../src/testing/daemon-harness'
import { makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon | undefined

afterEach(async () => {
  await daemon?.close()
  daemon = undefined
})

/** A daemon whose sessions see an empty home directory (no ~/.claude/settings.json). */
async function start(home?: string): Promise<TestDaemon> {
  const d = await startTestDaemon(home ? { home } : {})
  daemon = d
  const userHome = join(d.home, 'user-home')
  fs.mkdirSync(userHome, { recursive: true })
  vi.stubEnv('HOME', userHome)

  return d
}

async function idleWorkspace(d: TestDaemon): Promise<Workspace> {
  const project = await d.client.request('project.add', { path: makeTempRepo(d.home) })

  const ws = await d.client.request('workspace.create', {
    projectId: project.id,
    name: 'app-1432-retry-logic'
  })

  await waitForStatus(d, ws.id, 'idle')

  return ws
}

const HOUR = 3_600_000

/** A reading taken `ago` ms before now, with both windows well in the future. */
function reading(pct5: number, pct7: number, ago = 0): Usage {
  const now = Date.now()

  return {
    fiveHour: { pct: pct5, resetsAt: now + 2 * HOUR },
    sevenDay: { pct: pct7, resetsAt: now + 100 * HOUR },
    at: now - ago,
    workspaceId: 'ws_01hzx3k9c2qf'
  }
}

describe('usage', () => {
  describe('sessions', () => {
    it("reports a session's rate limits through its status line and prints the user's own line", async () => {
      const d = await start()
      const ws = await idleWorkspace(d)
      const changes = recordEvents(d.client, 'usage.changed')
      // The project's own status line: reads the JSON on stdin like any status line script.
      fs.mkdirSync(join(ws.path, '.claude'), { recursive: true })
      fs.writeFileSync(
        join(ws.path, '.claude', 'settings.local.json'),
        JSON.stringify({
          statusLine: {
            type: 'command',
            command:
              'read -r json; case "$json" in *five_hour*) echo "uploader line saw the limits";; esac'
          }
        })
      )
      const { term } = await runClaude(d, ws.id)

      await d.client.request('term.write', { id: term, data: '/statusline\r' })

      await expect
        .poll(async () => (await d.client.request('term.snapshot', { id: term })).text, {
          timeout: 15_000
        })
        .toContain('status line: uploader line saw the limits')
      await expect.poll(() => changes.length, { timeout: 10_000 }).toBe(1)
      const usage = await d.client.request('usage.get')
      expect(usage).toMatchObject({
        fiveHour: { pct: 42.5 },
        sevenDay: { pct: 18 },
        workspaceId: ws.id
      })
      // resets_at arrived in seconds: about 2 hours and 5 days from now, in ms.
      expect(usage?.fiveHour?.resetsAt).toBeGreaterThan(Date.now() + 1.9 * HOUR)
      expect(usage?.sevenDay?.resetsAt).toBeGreaterThan(Date.now() + 119 * HOUR)
      expect(changes[0]).toEqual(usage)
    }, 40_000)
  })

  describe('newest reading', () => {
    it('is what usage.get returns, and usage.changed carries it', async () => {
      const d = await start()
      const changes = recordEvents(d.client, 'usage.changed')
      expect(await d.client.request('usage.get')).toBeNull()

      const first = reading(42, 18)
      await d.client.request('usage.report', first)

      expect(await d.client.request('usage.get')).toEqual(first)
      await expect.poll(() => changes, { timeout: 5_000 }).toEqual([first])
    }, 20_000)

    it('ignores a reading older than the one it holds', async () => {
      const d = await start()
      const changes = recordEvents(d.client, 'usage.changed')
      const newer = reading(47, 21)
      await d.client.request('usage.report', newer)

      await d.client.request('usage.report', reading(44, 19, 30_000))
      const newest = reading(51, 22)
      newest.at = newer.at + 1
      await d.client.request('usage.report', newest)

      expect(await d.client.request('usage.get')).toEqual(newest)
      await expect.poll(() => changes, { timeout: 5_000 }).toEqual([newer, newest])
    }, 20_000)
  })

  describe('resets', () => {
    it('drops a window when it resets, then the whole reading when none is left', async () => {
      const d = await start()
      const changes = recordEvents(d.client, 'usage.changed')
      const now = Date.now()

      const soon: Usage = {
        fiveHour: { pct: 97, resetsAt: now + 400 },
        sevenDay: { pct: 63, resetsAt: now + 900 },
        at: now
      }

      await d.client.request('usage.report', soon)

      await expect
        .poll(() => changes, { timeout: 10_000 })
        .toEqual([soon, { sevenDay: soon.sevenDay, at: now }, null])
      expect(await d.client.request('usage.get')).toBeNull()
    }, 20_000)
  })

  describe('restart', () => {
    it('keeps the reading across a daemon restart', async () => {
      const first = await start()
      const kept = reading(42, 18)
      await first.client.request('usage.report', kept)
      await first.close({ keepHome: true })

      const d = await start(first.home)

      expect(await d.client.request('usage.get')).toEqual(kept)
    }, 20_000)
  })

  describe('errors', () => {
    it('refuses a report without a time', async () => {
      const d = await start()

      await expect(
        d.client.request('usage.report', { fiveHour: { pct: 4, resetsAt: Date.now() } } as Usage)
      ).rejects.toMatchObject({ code: 'bad_request' })
    }, 20_000)
  })
})
