// The overnight digest over the real socket: hook events land in the status
// log, report.get turns the log and the worktree into one digest per
// workspace, and workspaces nobody touched stay out. The window math itself
// is in src/daemon/digest.test.ts.
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Workspace } from '@shared/types'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { makeHookEvent } from '../../src/testing/fixtures'
import { gitIn, makeTempRepo } from '../../src/testing/temp-repo'
import { writeFileSync } from 'node:fs'

let daemon: TestDaemon | undefined

afterEach(async () => {
  await daemon?.close()
  daemon = undefined
})

async function idleWorkspace(d: TestDaemon, projectId: string, name: string): Promise<Workspace> {
  const ws = await d.client.request('workspace.create', { projectId, name })
  await expect
    .poll(async () => (await d.client.request('workspace.get', { id: ws.id })).status, {
      timeout: 10_000
    })
    .toBe('idle')

  return ws
}

async function setup(): Promise<{
  d: TestDaemon
  projectId: string
  busy: Workspace
  untouched: Workspace
  since: string
}> {
  const d = await startTestDaemon()
  daemon = d
  const project = await d.client.request('project.add', { path: makeTempRepo(d.home) })
  const busy = await idleWorkspace(d, project.id, 'app-1432-retry-logic')
  const untouched = await idleWorkspace(d, project.id, 'app-1433-docs')
  // Creation is behind us; the window opens after it.
  await d.client.request('workspace.list')
  const since = new Date().toISOString()

  return { d, projectId: project.id, busy, untouched, since }
}

const hook = (
  d: TestDaemon,
  ws: Workspace,
  event: Parameters<typeof makeHookEvent>[0],
  extra = {}
) =>
  d.client.request('hook.event', {
    workspaceId: ws.id,
    payload: makeHookEvent(event, { cwd: ws.path, ...extra })
  })

const permission = { notification_type: 'permission_prompt', message: 'needs permission' }

describe('the overnight digest', () => {
  it('logs each status change in order', async () => {
    const { d, busy } = await setup()

    await hook(d, busy, 'UserPromptSubmit')
    await hook(d, busy, 'Notification', permission)
    await hook(d, busy, 'Stop')

    await expect
      .poll(() =>
        d.server.store.listStatusLog(busy.id, '1970-01-01T00:00:00.000Z').map((r) => r.status)
      )
      .toEqual(['preparing', 'idle', 'working', 'needs_input', 'idle'])
  })

  it('reports a waiting session, then its time worked once it stops, and omits the untouched one', async () => {
    const { d, busy, untouched, since } = await setup()

    await hook(d, busy, 'UserPromptSubmit')
    // Let the clock move past the prompt, so the session has worked a measurable time.
    await expect
      .poll(async () => (await d.client.request('report.get', { since })).workspaces[0]?.workingMs)
      .toBeGreaterThan(0)
    await hook(d, busy, 'Notification', permission)

    const waiting = await d.client.request('report.get', { since })
    expect(waiting.workspaces.map((w) => w.id)).toEqual([busy.id])
    expect(waiting.workspaces[0]).toMatchObject({
      name: busy.name,
      status: 'needs_input',
      needsInputCount: 1,
      commitsAhead: 0
    })
    expect(waiting.workspaces[0].waitingSince).toEqual(expect.any(String))
    expect(waiting.workspaces.some((w) => w.id === untouched.id)).toBe(false)
    expect(waiting.totals).toMatchObject({ workspaces: 1, needsInput: 1 })

    await hook(d, busy, 'Stop')

    await expect
      .poll(async () => (await d.client.request('report.get', { since })).workspaces[0])
      .toMatchObject({ status: 'idle', waitingSince: null, needsInputCount: 1 })
    const stopped = await d.client.request('report.get', { since })
    expect(stopped.workspaces[0].workingMs).toBeGreaterThan(0)
    expect(stopped.totals).toMatchObject({ workspaces: 1, needsInput: 0 })
  })

  it('counts the commits made in the worktree against the base', async () => {
    const { d, busy, since } = await setup()
    await hook(d, busy, 'UserPromptSubmit')
    writeFileSync(join(busy.path, 'retry.ts'), 'export const retries = 3\n')
    gitIn(busy.path, 'add', '.')
    gitIn(busy.path, 'commit', '-m', 'Retry uploads')

    const report = await d.client.request('report.get', { since })

    expect(report.workspaces[0]).toMatchObject({ id: busy.id, commitsAhead: 1 })
  })
})
