// Pull request tracking over the real socket: the daemon polls the fake gh
// (PR state file, QUE_FAKE_GH_FAIL) for each workspace's branch, and looks up
// the pull request workspace.createPr opened by number. Which one is current, the
// order and the cap are pr-state.test.ts's.
import fs from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonClient } from '@shared/client'
import { recordEvents, startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import {
  addFakePullRequest,
  readFakeLog,
  readFakePullRequests,
  setFakePullRequest
} from '../../src/testing/fakes'
import { addBareOrigin, gitIn, makeTempRepo } from '../../src/testing/temp-repo'

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

const prNumbersOf = async (id: string) =>
  (await client.request('workspace.get', { id })).prs.map((p) => p.number)

const prViews = () => readFakeLog(daemon.ghLog).filter((c) => c.argv[1] === 'view')
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

  it('lists every pull request on the branch and follows the open one', async () => {
    const ws = await workspace()
    const updates = recordEvents(client, 'workspace.updated')
    setFakePullRequest(daemon.ghPrs, ws.branch, {
      number: 41,
      url: 'https://github.com/rquellh/que/pull/41',
      state: 'MERGED',
      isDraft: false,
      mergedAt: '2026-10-14T01:00:00Z',
      updatedAt: '2026-10-14T05:00:00Z'
    })
    addFakePullRequest(daemon.ghPrs, ws.branch, {
      number: 42,
      title: 'Retry the uploader on 503',
      isDraft: false,
      updatedAt: '2026-10-14T02:00:00Z',
      additions: 9,
      deletions: 1
    })

    await expect.poll(() => prNumbersOf(ws.id), opts).toEqual([42, 41])
    expect(await prOf(ws.id)).toMatchObject({
      number: 42,
      state: 'open',
      additions: 9,
      deletions: 1
    })

    setFakePullRequest(daemon.ghPrs, ws.branch, {
      number: 42,
      state: 'CLOSED',
      updatedAt: '2026-10-14T03:00:00Z'
    })
    await expect.poll(async () => (await prOf(ws.id))?.number, opts).toBe(41)
    expect(await prNumbersOf(ws.id)).toEqual([42, 41])
    expect(
      updates.some((w) => w.id === ws.id && w.pr?.number === 41 && w.prs[0]?.state === 'closed')
    ).toBe(true)
  }, 30_000)

  it('adds the pull request workspace.createPr opened once it leaves the branch, never twice', async () => {
    const ws = await workspace()
    const wsId = ws.id
    const branch = ws.branch
    fs.writeFileSync(join(ws.path, 'retry.ts'), 'export const retries = 3\n')

    const { prUrl } = await client.request('workspace.createPr', {
      id: wsId,
      title: 'Add retry logic to the uploader'
    })

    expect(prUrl).toBe('https://github.com/rquellh/que/pull/1')

    // On the branch, the recorded pull request is listed once and never looked up on its own.
    await expect.poll(() => prNumbersOf(wsId), opts).toEqual([1])
    expect(prViews()).toEqual([])

    // It is merged from another head, and a new one is opened from the branch.
    const all = readFakePullRequests(daemon.ghPrs)
    all['APP-1432-old-head'] = all[branch].map((pr) => ({
      ...pr,
      headRefName: 'APP-1432-old-head',
      state: 'MERGED' as const,
      mergedAt: '2026-10-14T03:00:00Z'
    }))
    delete all[branch]
    fs.writeFileSync(daemon.ghPrs, JSON.stringify(all))
    addFakePullRequest(daemon.ghPrs, branch, { number: 2, isDraft: false })

    await expect.poll(() => prNumbersOf(wsId), opts).toEqual([2, 1])
    expect(await prOf(wsId)).toMatchObject({ number: 2, state: 'open' })
    expect(prViews().some((c) => c.argv[2] === '1')).toBe(true)
    expect(prViews().some((c) => c.argv[2] === '2')).toBe(false)
  }, 60_000)

  describe('a branch checked out in the worktree', () => {
    it('becomes the workspace branch and finds the pull request opened from it', async () => {
      const ws = await workspace()
      const updates = recordEvents(client, 'workspace.updated')
      gitIn(ws.path, 'checkout', '--quiet', '-b', 'fix/upload-timeout')
      setFakePullRequest(daemon.ghPrs, 'fix/upload-timeout', {
        number: 57,
        url: 'https://github.com/rquellh/que/pull/57',
        isDraft: false
      })

      await expect
        .poll(async () => await prOf(ws.id), opts)
        .toMatchObject({ number: 57, state: 'open' })
      expect(updates.some((w) => w.id === ws.id && w.branch === 'fix/upload-timeout')).toBe(true)
    }, 30_000)

    it('keeps the recorded branch while the worktree is on a detached HEAD', async () => {
      const ws = await workspace()
      gitIn(ws.path, 'checkout', '--quiet', '--detach')
      setFakePullRequest(daemon.ghPrs, ws.branch, { isDraft: true })

      // The draft's arrival shows a check ran after the detach.
      await expect.poll(async () => (await prOf(ws.id))?.state, opts).toBe('draft')
      expect((await client.request('workspace.get', { id: ws.id })).branch).toBe(ws.branch)
    }, 30_000)
  })
})
