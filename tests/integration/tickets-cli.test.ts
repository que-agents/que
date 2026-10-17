// The ticket commands of the real `que` CLI, as subprocesses against the
// in-process daemon and the fake acli.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketsListResult } from '@shared/protocol'
import { runCli, runCliJson } from '../../src/testing/cli'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import {
  fakeParentOf,
  makeFakeEpic,
  makeFakeIssue,
  writeFakeTickets
} from '../../src/testing/fakes'
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
    const list = await runCliJson<TicketsListResult>('tickets', '--json')
    expect(list.tickets.map((t) => t.key)).toEqual(['APP-1432'])
    expect(list.sync.error).toBeNull()
  })

  it('prints a table', async () => {
    const r = await runCli('tickets')
    expect(r.code).toBe(0)
    const [header, row] = r.stdout.trim().split('\n')
    expect(header).toMatch(/^KEY\s+SUMMARY\s+STATUS\s+PRIORITY\s+UPDATED\s+WORKSPACE$/)
    expect(row).toMatch(
      /^APP-1432\s+Add retry logic to the uploader\s+In Progress\s+Medium\s+-\s+-$/
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

describe('que tickets with epics', () => {
  beforeEach(async () => {
    const epic = makeFakeEpic()
    const stray = makeFakeEpic({ key: 'APP-1300', fields: { summary: 'Not mine' } })
    writeFakeTickets(daemon.acliTickets, [
      epic,
      makeFakeIssue({
        key: 'APP-1401',
        fields: { summary: 'First', parent: fakeParentOf(epic) }
      }),
      makeFakeIssue({
        key: 'APP-1402',
        fields: { summary: 'Second', parent: fakeParentOf(stray) }
      }),
      makeFakeIssue({ key: 'APP-1500', fields: { summary: 'Loose' } })
    ])
    await daemon.client.request('tickets.sync', {})
    await expect
      .poll(async () => (await daemon.client.request('tickets.list', {})).tickets.length)
      .toBe(5)
  })

  it('prints a tree: epics with their tickets indented, loose tickets last', async () => {
    const lines = (await runCli('tickets')).stdout.trim().split('\n')
    expect(lines[0]).toMatch(/^KEY\s+SUMMARY/)
    const [e1, c1, e2, c2, loose] = lines.slice(1)
    expect(e1).toBe('APP-1400  Uploader reliability  In Progress')
    expect(c1).toMatch(/^ {2}APP-1401 +First +In Progress +Medium/)
    expect(e2).toBe('APP-1300  Not mine  In Progress (not yours)')
    expect(c2).toMatch(/^ {2}APP-1402 +Second /)
    expect(loose).toMatch(/^APP-1500 +Loose /)
  })

  it('carries level, parentKey and assigned in the JSON', async () => {
    const list = await runCliJson<TicketsListResult>('tickets', '--json')
    const by = Object.fromEntries(list.tickets.map((t) => [t.key, t]))
    expect(by['APP-1400']).toMatchObject({ level: 'epic', parentKey: null, assigned: true })
    expect(by['APP-1300']).toMatchObject({ level: 'epic', assigned: false })
    expect(by['APP-1401']).toMatchObject({ level: 'standard', parentKey: 'APP-1400' })
  })

  it('refuses to start an epic', async () => {
    const r = await runCli('tickets', 'start', 'APP-1400')
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('APP-1400 is an epic, an overview; start one of its tickets')
  })
})
