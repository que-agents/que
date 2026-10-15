// The ticket commands of the real `que` CLI, as subprocesses against the
// in-process daemon and the fake acli.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketsListResult } from '@shared/protocol'
import { runCli } from '../../src/testing/cli'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { makeFakeIssue, writeFakeTickets } from '../../src/testing/fakes'
import { makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon

beforeEach(async () => {
  daemon = await startTestDaemon()
  writeFakeTickets(daemon.acliTickets, [makeFakeIssue()])
  await daemon.client.request('tickets.sync', {})
})

afterEach(async () => {
  await daemon.close()
})

describe('que tickets', () => {
  it('prints the list as JSON', async () => {
    const r = await runCli('tickets', '--json')
    expect(r.code).toBe(0)
    const list = JSON.parse(r.stdout) as TicketsListResult
    expect(list.tickets.map((t) => t.key)).toEqual(['APP-1432'])
    expect(list.sync.error).toBeNull()
  })

  it('prints a table', async () => {
    const r = await runCli('tickets')
    expect(r.code).toBe(0)
    const [header, row] = r.stdout.trim().split('\n')
    expect(header).toMatch(/^KEY\s+SUMMARY\s+STATUS\s+PRIORITY\s+UPDATED\s+WORKSPACE$/)
    expect(row).toMatch(
      /^APP-1432\s+Add retry logic to the uploader\s+In Progress\s+Medium\s+\d+[smhd]\s+-$/
    )
  })

  it('syncs, and shows the failure line first', async () => {
    vi.stubEnv('QUE_FAKE_ACLI_FAIL', 'auth')
    const r = await runCli('tickets', 'sync')
    expect(r.code).toBe(0)
    expect(r.stdout.split('\n')[0]).toBe('sync error: Not authenticated. Run acli jira auth login.')
    expect(r.stdout).toContain('APP-1432')
  })
})

describe('que tickets start', () => {
  it('asks for a project with exit code 2, then starts with -p', async () => {
    const repo = makeTempRepo(daemon.home)
    const project = await daemon.client.request('project.add', { path: repo, name: 'uploader' })

    const without = await runCli('tickets', 'start', 'APP-1432')
    expect(without.code).toBe(2)
    expect(without.stderr).toContain('que cannot tell which project; pass -p <project>:')
    expect(without.stderr).toContain('uploader')

    const withProject = await runCli('tickets', 'start', 'APP-1432', '-p', 'uploader')
    expect(withProject.code).toBe(0)
    expect(withProject.stdout.trim()).toBe('app-1432-add-retry-logic-to-the-uploader')
    expect(await daemon.client.request('workspace.list', { projectId: project.id })).toHaveLength(1)

    const learned = await runCli('tickets', 'start', 'APP-1432')
    expect(learned.code).toBe(0)
    expect(learned.stdout.trim()).toBe('app-1432-add-retry-logic-to-the-uploader')
  })

  it('prints the terminal id for a session', async () => {
    const r = await runCli('tickets', 'start', 'APP-1432', '--session')
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toMatch(/^session \S+$/)
  })
})
