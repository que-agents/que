// Quiet hours in the daemon, over the real socket: entering them drops every
// terminal subscription and refuses detail, unlock and lock (and the log),
// an unlock that runs out on its own, headless tasks running on regardless,
// config.set reloading live with the apply-tonight guardrail, the morning
// summary, and a manual quiet (`quiet.start` / `quiet.end`) during the day. The clock math itself is in quiet-hours.test.ts; here the daemon
// reads a clock shifted to just before (or inside) a window.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DaemonClient } from '@shared/client'
import {
  recordEvents,
  startTestDaemon,
  type TestDaemon,
  waitForStatus,
  waitForTaskState
} from '../../src/testing/daemon-harness'
import { makeHookEvent } from '../../src/testing/fixtures'
import { addBareOrigin, makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon | undefined

afterEach(async () => {
  await daemon?.close()
  daemon = undefined
})

/** Real time, shifted so that "now" starts at `start` (local wall clock). */
function clockFrom(start: Date): () => number {
  const offset = start.getTime() - Date.now()

  return () => Date.now() + offset
}

const QUIET = (extra = ''): string =>
  `[quiet_hours]\nenabled = true\ndefault = ["19:00", "07:00"]\n${extra}`

const REFUSAL = {
  code: 'quiet_hours',
  message: 'quiet hours until 07:00; run `que unlock` for 20 minutes'
}

/** Wed 14 Oct 2026, 02:00: inside Tuesday's 19:00-07:00 window. */
const NIGHT = new Date(2026, 9, 14, 2, 0)

/** Wed 14 Oct 2026, 12:00: work hours. */
const DAY = new Date(2026, 9, 14, 12, 0)

const MANUAL_REFUSAL = {
  code: 'quiet_hours',
  message: 'quiet until 12:30; run `que quiet end`, or `que unlock` for 20 minutes'
}

async function start(config: string, now: Date): Promise<TestDaemon> {
  daemon = await startTestDaemon({ config, now: clockFrom(now) })

  return daemon
}

const cat = { file: '/bin/cat', name: 'uploader-shell', cols: 80, rows: 24 }

describe('quiet hours', () => {
  describe('entering quiet hours', () => {
    it('drops a client terminal subscription, keeps the terminal running, and refuses term.attach', async () => {
      const d = await start(QUIET(), new Date(2026, 9, 13, 18, 59, 58))
      const changes = recordEvents(d.client, 'quiet.changed')
      const data = recordEvents(d.client, 'term.data')
      const { id } = await d.client.request('term.create', cat)
      await d.client.request('term.attach', { id, cols: 80, rows: 24 })

      await expect
        .poll(() => changes.some((q) => q.inQuietHours && q.unlockedUntil === null), {
          timeout: 10_000
        })
        .toBe(true)
      await expect(
        d.client.request('term.attach', { id, cols: 80, rows: 24 })
      ).rejects.toMatchObject(REFUSAL)
      await d.client.request('term.write', { id, data: 'QUE_DETACHED_5b1e\n' })
      // A second client unlocks to read the screen: the terminal ran on, and
      // the first client (still detached) never received its output.
      const other = new DaemonClient(d.socket)
      await other.connect()

      try {
        await other.request('quiet.unlock', { why: 'check the detach' })
        await expect
          .poll(async () => (await other.request('term.snapshot', { id })).text, {
            timeout: 10_000
          })
          .toContain('QUE_DETACHED_5b1e')
        expect(data.map((e) => e.data).join('')).not.toContain('QUE_DETACHED_5b1e')
        expect((await d.client.request('term.list'))[0]).toMatchObject({ id, alive: true })
      } finally {
        other.close()
      }
    }, 30_000)
  })

  describe('unlock and lock', () => {
    it('lets detail through while unlocked, refuses it again after lock, and logs why', async () => {
      const d = await start(QUIET(), NIGHT)

      expect(await d.client.request('quiet.state')).toMatchObject({
        enabled: true,
        inQuietHours: true,
        windowStart: new Date(2026, 9, 13, 19, 0).toISOString(),
        windowEnd: new Date(2026, 9, 14, 7, 0).toISOString(),
        nextBoundary: new Date(2026, 9, 14, 7, 0).toISOString(),
        unlockedUntil: null,
        unlockMinutes: 20,
        locked: true
      })
      await expect(d.client.request('term.create', cat)).rejects.toMatchObject(REFUSAL)

      const unlocked = await d.client.request('quiet.unlock', { why: 'check the deploy' })
      expect(unlocked.locked).toBe(false)
      expect(Date.parse(unlocked.unlockedUntil ?? '') - NIGHT.getTime()).toBeGreaterThan(
        19 * 60_000
      )
      const { id } = await d.client.request('term.create', cat)
      expect(await d.client.request('term.attach', { id, cols: 80, rows: 24 })).toMatchObject({
        cols: 80
      })

      const relocked = await d.client.request('quiet.lock')
      expect(relocked.unlockedUntil).toBeNull()
      expect(relocked.locked).toBe(true)
      await expect(
        d.client.request('term.attach', { id, cols: 80, rows: 24 })
      ).rejects.toMatchObject(REFUSAL)
      const log = await d.client.request('quiet.log')
      expect(log).toEqual([
        {
          at: expect.any(String),
          minutes: 20,
          why: 'check the deploy',
          endedAt: expect.any(String)
        }
      ])
    }, 20_000)

    it('ends an unlock on its own when its minutes run out', async () => {
      const d = await start(QUIET('unlock_minutes = 0.05\n'), NIGHT)
      const changes = recordEvents(d.client, 'quiet.changed')

      const unlocked = await d.client.request('quiet.unlock')
      expect(unlocked.unlockedUntil).not.toBeNull()
      const { id } = await d.client.request('term.create', cat)

      await expect.poll(() => changes.at(-1)?.unlockedUntil, { timeout: 10_000 }).toBeNull()
      expect(changes.at(-1)?.inQuietHours).toBe(true)
      await expect(d.client.request('term.snapshot', { id })).rejects.toMatchObject({
        code: 'quiet_hours',
        message: 'quiet hours until 07:00; run `que unlock` for 0.05 minutes'
      })
      const [entry] = await d.client.request('quiet.log')
      expect(entry.endedAt).toBe(unlocked.unlockedUntil)
    }, 20_000)

    it('does nothing outside quiet hours', async () => {
      const d = await start(QUIET(), new Date(2026, 9, 14, 12, 0))

      const q = await d.client.request('quiet.unlock', { minutes: 5 })

      expect(q).toMatchObject({ inQuietHours: false, unlockedUntil: null, locked: false })
      expect(await d.client.request('quiet.log')).toEqual([])
    })
  })

  describe('headless tasks', () => {
    it('refuses report.get and task.add while quiet, but a running task runs on to done', async () => {
      vi.stubEnv('QUE_FAKE_CLAUDE_DELAY_MS', '250')
      const d = await start(QUIET(), NIGHT)
      const repo = makeTempRepo(d.home)
      addBareOrigin(repo)
      const { id: projectId } = await d.client.request('project.add', { path: repo })
      await d.client.request('quiet.unlock', { why: 'queue tonight' })

      const task = await d.client.request('task.add', {
        projectId,
        brief: 'Add retry logic to the uploader'
      })

      await d.client.request('queue.open')
      await waitForTaskState(d, task.id, 'running', 15_000)

      await d.client.request('quiet.lock')

      await expect(d.client.request('report.get')).rejects.toMatchObject(REFUSAL)
      await expect(
        d.client.request('task.add', { projectId, brief: 'Document the upload limits' })
      ).rejects.toMatchObject(REFUSAL)
      await waitForTaskState(d, task.id, 'done', 30_000)
      expect((await d.client.request('task.list')).map((t) => t.id)).toEqual([task.id])
    }, 45_000)
  })

  describe('config.set', () => {
    it('reloads concurrency live and emits config.changed', async () => {
      const d = await start(QUIET(), new Date(2026, 9, 14, 12, 0))
      const changed = recordEvents(d.client, 'config.changed')
      expect((await d.client.request('queue.state')).concurrency).toBe(2)

      const r = await d.client.request('config.set', { patch: { concurrency: 3 } })

      expect(r.config.concurrency).toBe(3)
      expect((await d.client.request('queue.state')).concurrency).toBe(3)
      await expect.poll(() => changed.length).toBe(1)
      expect(changed[0].path).toBe(d.configPath)
    })

    it('rejects an invalid patch without writing it', async () => {
      const d = await start(QUIET(), new Date(2026, 9, 14, 12, 0))

      await expect(
        d.client.request('config.set', {
          patch: { quietHours: { default: { start: '19:00', end: '19:00' } } }
        })
      ).rejects.toMatchObject({
        code: 'bad_request',
        message: 'invalid config: quiet_hours.default: start and end must differ'
      })
      expect((await d.client.request('config.get')).config.quietHours.default).toEqual({
        start: '19:00',
        end: '07:00'
      })
    })

    it("keeps tonight's window when an edit would end it early, unless applyTonight", async () => {
      const d = await start(QUIET(), NIGHT)
      const shorter = { quietHours: { default: { start: '19:00', end: '01:00' } } }

      const saved = await d.client.request('config.set', { patch: shorter })

      expect(saved.config.quietHours.default).toEqual({ start: '19:00', end: '01:00' })
      expect(await d.client.request('quiet.state')).toMatchObject({
        inQuietHours: true,
        windowEnd: new Date(2026, 9, 14, 7, 0).toISOString()
      })
      await expect(d.client.request('report.get')).rejects.toMatchObject({ code: 'quiet_hours' })

      await d.client.request('config.set', { patch: shorter, applyTonight: true })

      expect(await d.client.request('quiet.state')).toMatchObject({
        inQuietHours: false,
        nextBoundary: new Date(2026, 9, 14, 19, 0).toISOString()
      })
      expect((await d.client.request('report.get')).totals.tasks).toBe(0)
    })
  })

  describe('morning summary', () => {
    it('is emitted once, with the report since the window started, when the window ends', async () => {
      const d = await start(
        `${QUIET()}\n[notifications]\nmorning_summary = true\n`,
        new Date(2026, 9, 14, 6, 59, 58)
      )

      const summaries = recordEvents(d.client, 'quiet.morningSummary')
      const changes = recordEvents(d.client, 'quiet.changed')

      await expect.poll(() => summaries.length, { timeout: 10_000 }).toBe(1)
      expect(summaries[0].report.since).toBe(new Date(2026, 9, 13, 19, 0).toISOString())
      expect(changes.at(-1)).toMatchObject({ inQuietHours: false })

      // Later re-evaluations (a lock, the tick) never repeat it.
      await d.client.request('quiet.lock')
      await expect.poll(() => changes.length, { timeout: 5_000 }).toBeGreaterThanOrEqual(2)
      expect(summaries).toHaveLength(1)
    }, 20_000)

    it('covers a workspace that was working during the window', async () => {
      let offset = new Date(2026, 9, 13, 18, 0).getTime() - Date.now()
      daemon = await startTestDaemon({
        config: `${QUIET()}\n[notifications]\nmorning_summary = true\n`,
        now: () => Date.now() + offset
      })
      const d = daemon
      const summaries = recordEvents(d.client, 'quiet.morningSummary')
      const project = await d.client.request('project.add', { path: makeTempRepo(d.home) })

      const ws = await d.client.request('workspace.create', {
        projectId: project.id,
        name: 'app-1432-retry-logic'
      })

      await waitForStatus(d, ws.id, 'idle')
      await d.client.request('hook.event', {
        workspaceId: ws.id,
        payload: makeHookEvent('UserPromptSubmit', { cwd: ws.path })
      })

      offset = new Date(2026, 9, 14, 6, 59, 58).getTime() - Date.now()

      await expect.poll(() => summaries.length, { timeout: 15_000 }).toBe(1)
      expect(summaries[0].report.workspaces).toEqual([
        expect.objectContaining({ id: ws.id, name: ws.name, status: 'working' })
      ])
    }, 30_000)
  })

  describe('manual quiet', () => {
    it('locks like quiet hours: drops subscriptions, refuses detail, and unlocks and locks inside it', async () => {
      const d = await start(QUIET(), DAY)
      const changes = recordEvents(d.client, 'quiet.changed')
      const data = recordEvents(d.client, 'term.data')
      const { id } = await d.client.request('term.create', cat)
      await d.client.request('term.attach', { id, cols: 80, rows: 24 })

      const q = await d.client.request('quiet.start', { minutes: 30 })

      expect(q).toMatchObject({ inQuietHours: true, kind: 'manual', locked: true })
      expect(Date.parse(q.windowEnd ?? '') - Date.parse(q.windowStart ?? '')).toBe(30 * 60_000)
      expect(q.nextBoundary).toBe(q.windowEnd)
      await expect.poll(() => changes.some((c) => c.kind === 'manual')).toBe(true)
      await expect(
        d.client.request('task.add', { projectId: 'proj_01hzx3k9c2qf', brief: 'Add retries' })
      ).rejects.toMatchObject(MANUAL_REFUSAL)
      await d.client.request('term.write', { id, data: 'QUE_MANUAL_7c2d\n' })

      const unlocked = await d.client.request('quiet.unlock', { why: 'read the build log' })

      expect(unlocked).toMatchObject({ kind: 'manual', locked: false })
      await expect
        .poll(async () => (await d.client.request('term.snapshot', { id })).text, {
          timeout: 10_000
        })
        .toContain('QUE_MANUAL_7c2d')
      expect(data.map((e) => e.data).join('')).not.toContain('QUE_MANUAL_7c2d')

      const relocked = await d.client.request('quiet.lock')

      expect(relocked).toMatchObject({ kind: 'manual', unlockedUntil: null, locked: true })
      await expect(d.client.request('term.snapshot', { id })).rejects.toMatchObject(MANUAL_REFUSAL)
    }, 30_000)

    it('ends on quiet.end, back to work hours', async () => {
      const d = await start(QUIET(), DAY)
      await d.client.request('quiet.start', { minutes: 30 })
      const changes = recordEvents(d.client, 'quiet.changed')

      const q = await d.client.request('quiet.end')

      expect(q).toMatchObject({ inQuietHours: false, kind: null, locked: false })
      expect(q.nextBoundary).toBe(new Date(2026, 9, 14, 19, 0).toISOString())
      await expect.poll(() => changes.at(-1)?.kind).toBeNull()
      expect((await d.client.request('report.get')).totals.tasks).toBe(0)
    })

    it('ends on its own when its minutes run out', async () => {
      const d = await start(QUIET(), DAY)
      const changes = recordEvents(d.client, 'quiet.changed')

      await d.client.request('quiet.start', { minutes: 0.05 })

      await expect
        .poll(() => changes.at(-1), { timeout: 10_000 })
        .toMatchObject({
          inQuietHours: false,
          kind: null,
          locked: false
        })
    }, 20_000)

    it('is still locked after a restart on the same home', async () => {
      const now = clockFrom(DAY)
      const first = await startTestDaemon({ config: QUIET(), now })
      daemon = first
      const started = await first.client.request('quiet.start', { minutes: 30 })
      await first.close({ keepHome: true })

      const d = await startTestDaemon({ config: QUIET(), now, home: first.home })
      daemon = d

      expect(await d.client.request('quiet.state')).toMatchObject({
        inQuietHours: true,
        kind: 'manual',
        windowEnd: started.windowEnd,
        locked: true
      })
    }, 20_000)

    it('stays on when quiet_hours change, and keeps its peeks out of the unlock log', async () => {
      const d = await start(QUIET(), DAY)
      await d.client.request('quiet.start', { minutes: 30 })
      await d.client.request('quiet.unlock', { minutes: 5, why: 'check the deploy' })
      await d.client.request('quiet.lock')

      await d.client.request('config.set', {
        patch: { quietHours: { default: { start: '20:00', end: '06:00' } } }
      })

      expect(await d.client.request('quiet.state')).toMatchObject({
        kind: 'manual',
        locked: true
      })
      expect(await d.client.request('quiet.log')).toEqual([])
    })

    it('leaves quiet hours unchanged when started inside them', async () => {
      const d = await start(QUIET(), NIGHT)

      const q = await d.client.request('quiet.start', { minutes: 30 })

      expect(q).toMatchObject({
        inQuietHours: true,
        kind: 'scheduled',
        windowEnd: new Date(2026, 9, 14, 7, 0).toISOString(),
        locked: true
      })
    })

    it('keeps quiet hours locked when the manual window it took over would have ended, and on quiet.end', async () => {
      // Two seconds before 19:00, a six-second manual quiet. Quiet hours take it over at
      // 19:00; its own end, at 19:00:04, and a quiet.end must both leave them locked.
      const now = clockFrom(new Date(2026, 9, 14, 18, 59, 58))
      const d = await startTestDaemon({ config: QUIET(), now })
      daemon = d
      const changes = recordEvents(d.client, 'quiet.changed')
      const started = await d.client.request('quiet.start', { minutes: 0.1 })
      const manualEnd = Date.parse(started.windowEnd ?? '')

      await expect.poll(() => changes.at(-1)?.kind, { timeout: 10_000 }).toBe('scheduled')
      await expect.poll(() => now() > manualEnd + 500, { timeout: 15_000 }).toBe(true)
      expect(await d.client.request('quiet.state')).toMatchObject({
        kind: 'scheduled',
        locked: true
      })

      expect(await d.client.request('quiet.end')).toMatchObject({
        kind: 'scheduled',
        locked: true
      })
      await expect(d.client.request('term.create', cat)).rejects.toMatchObject(REFUSAL)
    }, 30_000)

    it('is ended by quiet hours starting inside it, so it cannot resurface when they end', async () => {
      const d = await start(QUIET(), new Date(2026, 9, 14, 18, 59, 58))
      const changes = recordEvents(d.client, 'quiet.changed')
      await d.client.request('quiet.start', { minutes: 30 })

      await expect.poll(() => changes.at(-1)?.kind, { timeout: 10_000 }).toBe('scheduled')
      await d.client.request('config.set', {
        patch: { quietHours: { enabled: false } },
        applyTonight: true
      })

      expect(await d.client.request('quiet.state')).toMatchObject({
        inQuietHours: false,
        kind: null
      })
    }, 20_000)

    it('refuses minutes of 0 or more than 720', async () => {
      const d = await start(QUIET(), DAY)

      for (const minutes of [0, 721]) {
        await expect(d.client.request('quiet.start', { minutes })).rejects.toMatchObject({
          code: 'bad_request',
          message: 'minutes must be more than 0 and at most 720'
        })
      }
    })
  })
})
