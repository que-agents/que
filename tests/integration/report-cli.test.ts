// `que report` of the real CLI, as a subprocess against the in-process daemon.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Report } from '@shared/protocol'
import { runCli, runCliJson } from '../../src/testing/cli'
import { startTestDaemon, type TestDaemon, waitForStatus } from '../../src/testing/daemon-harness'
import { makeHookEvent } from '../../src/testing/fixtures'
import { makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon

beforeEach(async () => {
  daemon = await startTestDaemon()
})

afterEach(async () => {
  await daemon.close()
})

describe('que report', () => {
  it('carries the interactive workspaces in --json and prints them as text', async () => {
    const project = await daemon.client.request('project.add', { path: makeTempRepo(daemon.home) })

    const ws = await daemon.client.request('workspace.create', {
      projectId: project.id,
      name: 'app-1432-retry-logic'
    })

    await waitForStatus(daemon, ws.id, 'idle')
    await daemon.client.request('hook.event', {
      workspaceId: ws.id,
      payload: makeHookEvent('UserPromptSubmit', { cwd: ws.path })
    })

    const report = await runCliJson<Report>('report', '--json', '--since', '1h')
    expect(report.workspaces).toEqual([
      expect.objectContaining({ id: ws.id, name: ws.name, status: 'working', commitsAhead: 0 })
    ])
    expect(report.totals).toEqual({ workspaces: 1, needsInput: 0 })
    const text = await runCli('report', '--since', '1h')
    expect(text.stdout).toMatch(/^que report since \S+\n1 session · worked /)
    expect(text.stdout).toContain('Workspaces (1)')
    expect(text.stdout).toContain(`  ${ws.name} · ${project.name} · working`)
    expect(text.stdout).not.toMatch(/Done|Total:/)
  }, 30_000)

  it('fails with a message for a bad --since', async () => {
    const since = await runCli('report', '--since', 'last tuesday')

    expect(since).toMatchObject({ code: 1, stderr: 'que: invalid --since last tuesday\n' })
  }, 30_000)
})
