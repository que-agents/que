// Interactive Claude sessions across a daemon restart: the fake claude in a
// workspace terminal reports its session through the hooks wrapper, the daemon
// stops the way the real shutdown does (every terminal killed, then the server
// closed), and the next daemon on the same QUE_HOME opens a terminal in the
// workspace that resumes the session. Ended sessions, killed terminals, and a
// locked quiet-hours start are the cases that wait or stay closed. The
// candidate rules themselves are in src/daemon/live-sessions.test.ts.
import { afterEach, describe, expect, it } from 'vitest'
import type { Workspace } from '@shared/types'
import { readFakeLog } from '../../src/testing/fakes'
import {
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

/** A daemon with one project; workspaces are added with `workspace()`. */
async function start(): Promise<{ d: TestDaemon; projectId: string }> {
  const d = await startTestDaemon()
  daemon = d
  const project = await d.client.request('project.add', { path: makeTempRepo(d.home) })

  return { d, projectId: project.id }
}

async function workspace(d: TestDaemon, projectId: string, name: string): Promise<Workspace> {
  const ws = await d.client.request('workspace.create', { projectId, name })
  await waitForStatus(d, ws.id, 'idle')

  return ws
}

/** Waits until the terminal's screen shows `text`. */
async function waitForScreen(d: TestDaemon, id: string, text: string): Promise<void> {
  await expect
    .poll(async () => (await d.client.request('term.snapshot', { id })).text, { timeout: 15_000 })
    .toContain(text)
}

/** The sessions the fake claude was asked to resume, in order. */
function resumed(d: TestDaemon): string[] {
  return readFakeLog(d.claudeLog).flatMap((call) => {
    const i = call.argv.indexOf('--resume')

    return i >= 0 ? [call.argv[i + 1]] : []
  })
}

async function terminalsOf(d: TestDaemon, wsId: string): Promise<string[]> {
  return (await d.client.request('term.list', { workspaceId: wsId })).map((t) => t.id)
}

/** Real time, shifted so that "now" starts at `at` (local wall clock). */
function clockFrom(at: Date): () => number {
  const offset = at.getTime() - Date.now()

  return () => Date.now() + offset
}

const QUIET = '[quiet_hours]\nenabled = true\ndefault = ["19:00", "07:00"]\n'

/** Wed 14 Oct 2026, 02:00: inside Tuesday's 19:00-07:00 window. */
const NIGHT = new Date(2026, 9, 14, 2, 0)

describe('resuming sessions after a daemon restart', () => {
  it('reopens the workspace terminal with claude resuming the same session', async () => {
    const first = await start()
    const ws = await workspace(first.d, first.projectId, 'app-1432-retry-logic')
    const { term, session } = await runClaude(first.d, ws.id)

    await first.d.close({ keepHome: true })
    daemon = await startTestDaemon({ home: first.d.home })
    const d = daemon

    await expect.poll(() => terminalsOf(d, ws.id), { timeout: 10_000 }).toHaveLength(1)
    const [restored] = await terminalsOf(d, ws.id)
    expect(restored).not.toBe(term)
    await expect.poll(() => resumed(d), { timeout: 20_000 }).toEqual([session])
    // A reply means the session's start hook has been delivered: it reads input only after.
    await d.client.request('term.write', { id: restored, data: 'where were we\r' })
    await waitForScreen(d, restored, 'Fake reply to: where were we')

    // The resumed session reports from its new terminal like any other, so the
    // next restart brings it back again.
    await d.close({ keepHome: true })
    daemon = await startTestDaemon({ home: first.d.home })
    const again = daemon

    await expect.poll(() => resumed(again), { timeout: 20_000 }).toEqual([session, session])
    expect(await terminalsOf(again, ws.id)).toHaveLength(1)
  }, 120_000)

  it('leaves closed a session Claude ended and a terminal the user killed', async () => {
    const first = await start()
    const live = await workspace(first.d, first.projectId, 'app-1432-retry-logic')
    const ended = await workspace(first.d, first.projectId, 'app-1433-upload-progress')
    const killed = await workspace(first.d, first.projectId, 'app-1434-flaky-login')
    const kept = await runClaude(first.d, live.id)
    const exited = await runClaude(first.d, ended.id)
    const closed = await runClaude(first.d, killed.id)

    // /exit fires SessionEnd (its hook delivered before claude exits), then the shell prompts again.
    await first.d.client.request('term.write', { id: exited.term, data: '/exit\r' })
    await first.d.client.request('term.write', {
      id: exited.term,
      data: 'echo que-exited-$((6*7))\r'
    })
    await waitForScreen(first.d, exited.term, 'que-exited-42')
    await first.d.client.request('term.kill', { id: closed.term })

    await first.d.close({ keepHome: true })
    daemon = await startTestDaemon({ home: first.d.home })
    const d = daemon

    await expect.poll(() => resumed(d), { timeout: 20_000 }).toEqual([kept.session])
    expect(await terminalsOf(d, live.id)).toHaveLength(1)
    expect(await terminalsOf(d, ended.id)).toEqual([])
    expect(await terminalsOf(d, killed.id)).toEqual([])
  }, 120_000)

  it('opens nothing while quiet hours are locked, then restores at the unlock', async () => {
    const first = await start()
    const ws = await workspace(first.d, first.projectId, 'app-1432-retry-logic')
    const { session } = await runClaude(first.d, ws.id)

    await first.d.close({ keepHome: true })
    daemon = await startTestDaemon({ home: first.d.home, config: QUIET, now: clockFrom(NIGHT) })
    const d = daemon

    expect((await d.client.request('quiet.state')).locked).toBe(true)
    // The restore runs as the daemon starts listening, so a locked start has already passed it.
    expect(await terminalsOf(d, ws.id)).toEqual([])
    expect(resumed(d)).toEqual([])

    await d.client.request('quiet.unlock', { why: 'pick the session back up' })

    await expect.poll(() => terminalsOf(d, ws.id), { timeout: 10_000 }).toHaveLength(1)
    await expect.poll(() => resumed(d), { timeout: 20_000 }).toEqual([session])
  }, 90_000)
})
