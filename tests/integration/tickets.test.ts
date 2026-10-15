// The ticket queue over the real socket: the daemon polls the fake acli
// (issue file, QUE_FAKE_ACLI_FAIL), and starting a ticket makes a workspace,
// a brief, and a claude terminal in it.
import fs from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonClient } from '@shared/client'
import { DEFAULT_START_PROMPT } from '@shared/config'
import type { Events } from '@shared/protocol'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { makeFakeIssue, readFakeLog, writeFakeTickets } from '../../src/testing/fakes'
import { gitIn, makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon
let client: DaemonClient

beforeEach(async () => {
  daemon = await startTestDaemon({ config: '[jira]\npoll_minutes = 0.002\n' })
  client = daemon.client
})

afterEach(async () => {
  await daemon.close()
})

const opts = { timeout: 10_000 }
const older = makeFakeIssue({
  key: 'APP-1100',
  fields: { summary: 'Older ticket', updated: '2026-10-01T09:00:00.000+0000' }
})
const newer = makeFakeIssue()
const keys = async () => (await client.request('tickets.list', {})).tickets.map((t) => t.key)
const syncError = async () => (await client.request('tickets.list', {})).sync.error

async function addProject() {
  const repo = makeTempRepo(daemon.home)
  return client.request('project.add', { path: repo })
}

describe('syncing the queue', () => {
  it('lists the tickets, newest updated first, and announces the sync', async () => {
    const synced: Events['tickets.synced'][] = []
    client.on('tickets.synced', (d) => synced.push(d))
    writeFakeTickets(daemon.acliTickets, [older, newer])

    await expect.poll(keys, opts).toEqual(['APP-1432', 'APP-1100'])
    const list = await client.request('tickets.list', {})
    expect(list.tickets[0]).toMatchObject({
      url: 'https://example.atlassian.net/browse/APP-1432',
      statusCategory: 'indeterminate',
      projectKey: 'APP',
      workspaceId: null
    })
    expect(list.sync).toMatchObject({ error: null, count: 2 })
    expect(list.sync.lastSyncAt).not.toBeNull()
    expect(synced.some((s) => s.tickets.length === 2)).toBe(true)
    expect(readFakeLog(daemon.acliLog)[0].argv.slice(0, 3)).toEqual(['jira', 'workitem', 'search'])
  })

  it('drops a vanished ticket on the next poll, but not one with a workspace', async () => {
    const project = await addProject()
    writeFakeTickets(daemon.acliTickets, [older, newer])
    await expect.poll(keys, opts).toHaveLength(2)
    await client.request('tickets.start', { key: 'APP-1100', projectId: project.id })

    writeFakeTickets(daemon.acliTickets, [])
    await expect.poll(keys, opts).toEqual(['APP-1100'])
    const before = (await client.request('tickets.list', {})).sync.lastSyncAt
    await expect
      .poll(async () => (await client.request('tickets.list', {})).sync.lastSyncAt, opts)
      .not.toBe(before)
    expect(await keys()).toEqual(['APP-1100'])
  })

  it('shows a sign-in failure, keeps the list, and clears it once signed in', async () => {
    writeFakeTickets(daemon.acliTickets, [newer])
    await expect.poll(keys, opts).toEqual(['APP-1432'])

    vi.stubEnv('QUE_FAKE_ACLI_FAIL', 'auth')
    await expect.poll(syncError, opts).toMatch(/^Not authenticated/)
    expect(await keys()).toEqual(['APP-1432'])

    vi.stubEnv('QUE_FAKE_ACLI_FAIL', '')
    await expect.poll(syncError, opts).toBeNull()
  })

  it('syncs on demand', async () => {
    writeFakeTickets(daemon.acliTickets, [newer])
    const r = await client.request('tickets.sync', {})
    expect(r.tickets.map((t) => t.key)).toEqual(['APP-1432'])
  })
})

describe('starting a ticket', () => {
  beforeEach(async () => {
    writeFakeTickets(daemon.acliTickets, [newer])
    await expect.poll(keys, opts).toEqual(['APP-1432'])
  })

  it('asks for a project when none is known', async () => {
    const project = await addProject()
    expect(await client.request('tickets.projectFor', { key: 'APP-1432' })).toEqual({
      projectId: null
    })
    const r = await client.request('tickets.start', { key: 'APP-1432' })
    expect(r.kind).toBe('needs_project')
    if (r.kind === 'needs_project') expect(r.projects.map((p) => p.id)).toEqual([project.id])
    expect(await client.request('workspace.list', {})).toEqual([])
  })

  it('refuses an unknown ticket', async () => {
    await expect(client.request('tickets.start', { key: 'APP-9' })).rejects.toThrow(/no ticket/)
  })

  it('makes a workspace with the brief, starts claude, learns the project, then reuses both', async () => {
    const project = await addProject()
    const r = await client.request('tickets.start', { key: 'APP-1432', projectId: project.id })
    expect(r.kind).toBe('workspace')
    if (r.kind !== 'workspace') return
    const ws = r.workspace
    expect(ws).toMatchObject({
      name: 'app-1432-add-retry-logic-to-the-uploader',
      projectId: project.id
    })

    const brief = fs.readFileSync(join(ws.path, '.que', 'ticket.md'), 'utf8')
    expect(brief).toContain('# APP-1432 Add retry logic to the uploader')
    expect(brief).toContain('https://example.atlassian.net/browse/APP-1432')
    expect(brief).toContain('## Description')
    expect(brief).toContain('- Retry three times')
    expect(brief).toContain('```ts\nawait retry(() => upload(file))\n```')
    expect(gitIn(ws.path, 'status', '--porcelain')).not.toContain('.que')

    expect(await client.request('term.list', { workspaceId: ws.id })).toHaveLength(1)
    await expect
      .poll(
        () => readFakeLog(daemon.claudeLog).some((c) => c.argv.includes(DEFAULT_START_PROMPT)),
        opts
      )
      .toBe(true)

    expect(fs.readFileSync(daemon.configPath, 'utf8')).toMatch(
      new RegExp(`\\[jira\\.projects\\]\\s+APP = "${project.name}"`)
    )
    expect(await client.request('tickets.projectFor', { key: 'APP-1432' })).toEqual({
      projectId: project.id
    })
    expect((await client.request('tickets.list', {})).tickets[0].workspaceId).toBe(ws.id)

    const again = await client.request('tickets.start', { key: 'APP-1432' })
    expect(again.kind === 'workspace' && again.workspace.id).toBe(ws.id)
    expect(await client.request('workspace.list', {})).toHaveLength(1)
    expect(await client.request('term.list', { workspaceId: ws.id })).toHaveLength(2)
  })

  it('writes the brief under the home for a loose session', async () => {
    const r = await client.request('tickets.start', { key: 'APP-1432', session: true })
    expect(r.kind).toBe('session')
    if (r.kind !== 'session') return
    expect(r.terminalId).toMatch(/\S/)
    const file = join(daemon.home, 'tickets', 'APP-1432.md')
    expect(fs.readFileSync(file, 'utf8')).toContain('# APP-1432')
    expect(await client.request('workspace.list', {})).toEqual([])
  })
})
