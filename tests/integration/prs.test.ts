// Pull request tracking over the real socket: the daemon polls the fake gh
// (PR state file, QUE_FAKE_GH_FAIL) for each workspace's branch.
import fs from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonClient } from '@shared/client'
import { recordEvents, startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { readFakeLog, setFakePullRequest } from '../../src/testing/fakes'
import { addBareOrigin, makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon
let client: DaemonClient

beforeEach(async () => {
  daemon = await startTestDaemon({ config: 'pr_poll_seconds = 0.2\n' })
  client = daemon.client
})

afterEach(async () => {
  await daemon.close()
})

async function project() {
  const repo = makeTempRepo(daemon.home)
  addBareOrigin(repo)

  return (await client.request('project.add', { path: repo })).id
}

async function workspace(branch?: string, projectId?: string) {
  return client.request('workspace.create', {
    projectId: projectId ?? (await project()),
    name: branch ?? 'APP-1432 retry logic',
    branch: branch || undefined
  })
}

const prOf = async (id: string) => (await client.request('workspace.get', { id })).pr
const opts = { timeout: 10_000 }

describe('pull request tracking', () => {
  it('follows a pull request from draft through failing checks to merged', async () => {
    const ws = await workspace()
    const updates = recordEvents(client, 'workspace.updated')
    expect(ws.pr).toBeNull()

    setFakePullRequest(daemon.ghPrs, ws.branch, { isDraft: true })
    await expect.poll(async () => (await prOf(ws.id))?.state, opts).toBe('draft')
    expect(updates.some((w) => w.id === ws.id && w.pr?.state === 'draft')).toBe(true)

    setFakePullRequest(daemon.ghPrs, ws.branch, {
      isDraft: false,
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }]
    })
    await expect
      .poll(async () => await prOf(ws.id), opts)
      .toMatchObject({
        state: 'open',
        checks: 'failing'
      })

    setFakePullRequest(daemon.ghPrs, ws.branch, {
      state: 'MERGED',
      mergedAt: '2026-10-14T03:00:00Z'
    })
    await expect.poll(async () => (await prOf(ws.id))?.state, opts).toBe('merged')
  }, 30_000)

  it('picks up the pull request that workspace.createPr opens', async () => {
    const ws = await workspace()
    fs.writeFileSync(join(ws.path, 'retry.ts'), 'export const retries = 3\n')

    const { prUrl } = await client.request('workspace.createPr', {
      id: ws.id,
      title: 'Add retry logic to the uploader'
    })

    await expect
      .poll(async () => await prOf(ws.id), opts)
      .toMatchObject({
        state: 'draft',
        number: 1,
        url: prUrl,
        title: 'Add retry logic to the uploader'
      })
  }, 30_000)

  it('never asks about a protected branch', async () => {
    const projectId = await project()
    const ws = await workspace('release', projectId)
    const feature = await workspace('feature-x', projectId)
    setFakePullRequest(daemon.ghPrs, 'release', {})
    setFakePullRequest(daemon.ghPrs, 'feature-x', {})
    await expect.poll(async () => (await prOf(feature.id))?.state, opts).toBe('draft')

    const listCalls = () => readFakeLog(daemon.ghLog).filter((c) => c.argv[1] === 'list').length
    const before = listCalls()
    // A few more polls of the feature workspace, so a release call would have shown.
    await expect.poll(listCalls, opts).toBeGreaterThan(before + 2)

    const lists = readFakeLog(daemon.ghLog).filter((c) => c.argv[1] === 'list')
    expect(lists.some((c) => c.argv.includes('release'))).toBe(false)
    expect((await prOf(ws.id)) ?? null).toBeNull()
  }, 30_000)

  it('keeps the stored pull request and keeps running when gh fails', async () => {
    const ws = await workspace()
    setFakePullRequest(daemon.ghPrs, ws.branch, { isDraft: true })
    await expect.poll(async () => (await prOf(ws.id))?.state, opts).toBe('draft')

    vi.stubEnv('QUE_FAKE_GH_FAIL', '1')
    const failedAt = readFakeLog(daemon.ghLog).length
    setFakePullRequest(daemon.ghPrs, ws.branch, {
      state: 'MERGED',
      mergedAt: '2026-10-14T03:00:00Z'
    })
    await expect.poll(() => readFakeLog(daemon.ghLog).length, opts).toBeGreaterThan(failedAt + 1)
    expect((await prOf(ws.id))?.state).toBe('draft')
    expect(await client.request('workspace.get', { id: ws.id })).toMatchObject({ id: ws.id })

    vi.stubEnv('QUE_FAKE_GH_FAIL', '')
    await expect.poll(async () => (await prOf(ws.id))?.state, opts).toBe('merged')
  }, 30_000)
})
