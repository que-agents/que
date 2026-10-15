// Quiet hours in the daemon, over the real socket: entering them drops every
// terminal subscription and refuses detail, unlock and lock (and the log),
// an unlock that runs out on its own, headless tasks running on regardless,
// config.set reloading live with the apply-tonight guardrail, and the morning
// summary. The clock math itself is in quiet-hours.test.ts; here the daemon
// reads a clock shifted to just before (or inside) a window.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DaemonClient } from '@shared/client'
import type { Events } from '@shared/protocol'
import type { TaskState } from '@shared/types'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
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

function record<E extends keyof Events>(c: DaemonClient, event: E): Events[E][] {
  const seen: Events[E][] = []
  c.on(event, (data) => seen.push(data))
  return seen
}

const QUIET = (extra = ''): string =>
  `[quiet_hours]\nenabled = true\ndefault = ["19:00", "07:00"]\n${extra}`

const REFUSAL = {
  code: 'quiet_hours',
  message: 'quiet hours until 07:00; run `que unlock` for 20 minutes'
}

/** Wed 14 Oct 2026, 02:00: inside Tuesday's 19:00-07:00 window. */
const NIGHT = new Date(2026, 9, 14, 2, 0)

async function start(config: string, now: Date): Promise<TestDaemon> {
  daemon = await startTestDaemon({ config, now: clockFrom(now) })
  return daemon
}

const cat = { file: '/bin/cat', name: 'uploader-shell', cols: 80, rows: 24 }

describe('quiet hours', () => {
  describe('entering quiet hours', () => {
    it('drops a client terminal subscription, keeps the terminal running, and refuses term.attach', async () => {
      const d = await start(QUIET(), new Date(2026, 9, 13, 18, 59, 58))
      const changes = record(d.client, 'quiet.changed')
      const data = record(d.client, 'term.data')
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
        unlockMinutes: 20
      })
      await expect(d.client.request('term.create', cat)).rejects.toMatchObject(REFUSAL)

      const unlocked = await d.client.request('quiet.unlock', { why: 'check the deploy' })
      expect(Date.parse(unlocked.unlockedUntil ?? '') - NIGHT.getTime()).toBeGreaterThan(
        19 * 60_000
      )
      const { id } = await d.client.request('term.create', cat)
      expect(await d.client.request('term.attach', { id, cols: 80, rows: 24 })).toMatchObject({
        cols: 80
      })

      expect((await d.client.request('quiet.lock')).unlockedUntil).toBeNull()
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
      const changes = record(d.client, 'quiet.changed')

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

      expect(q).toMatchObject({ inQuietHours: false, unlockedUntil: null })
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
      await expect
        .poll(async () => (await d.client.request('task.get', { id: task.id })).state, {
          timeout: 15_000
        })
        .toBe('running')

      await d.client.request('quiet.lock')

      await expect(d.client.request('report.get')).rejects.toMatchObject(REFUSAL)
      await expect(
        d.client.request('task.add', { projectId, brief: 'Document the upload limits' })
      ).rejects.toMatchObject(REFUSAL)
      await expect
        .poll(
          async () => (await d.client.request('task.get', { id: task.id })).state as TaskState,
          { timeout: 30_000 }
        )
        .toBe('done')
      expect((await d.client.request('task.list')).map((t) => t.id)).toEqual([task.id])
    }, 45_000)
  })

  describe('config.set', () => {
    it('reloads concurrency live and emits config.changed', async () => {
      const d = await start(QUIET(), new Date(2026, 9, 14, 12, 0))
      const changed = record(d.client, 'config.changed')
      expect((await d.client.request('queue.state')).concurrency).toBe(2)

      const r = await d.client.request('config.set', { patch: { concurrency: 3 } })

      expect(r.config.concurrency).toBe(3)
      expect(r.raw).toMatchObject({ concurrency: 3, quiet_hours: { enabled: true } })
      expect((await d.client.request('queue.state')).concurrency).toBe(3)
      await expect.poll(() => changed.length).toBe(1)
      expect(changed[0].path).toBe(d.configPath)
    })

    it('rejects an invalid patch without writing it', async () => {
      const d = await start(QUIET(), new Date(2026, 9, 14, 12, 0))

      await expect(
        d.client.request('config.set', { patch: { quiet_hours: { default: ['19:00', '19:00'] } } })
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
      const shorter = { quiet_hours: { default: ['19:00', '01:00'] } }

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
      const summaries = record(d.client, 'quiet.morningSummary')
      const changes = record(d.client, 'quiet.changed')

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
      const summaries = record(d.client, 'quiet.morningSummary')
      const project = await d.client.request('project.add', { path: makeTempRepo(d.home) })
      const ws = await d.client.request('workspace.create', {
        projectId: project.id,
        name: 'app-1432-retry-logic'
      })
      await expect
        .poll(async () => (await d.client.request('workspace.get', { id: ws.id })).status, {
          timeout: 10_000
        })
        .toBe('idle')
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
})
