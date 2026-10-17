// workspace.prThread and the check runs over the real socket: the daemon reads
// the fake gh's pull request file (comments, reviews, line comments, rollup),
// caches the conversation until the tracker sees updatedAt move, and maps gh
// failures to gh_failed. `que ws pr` prints both.
// Quiet-hours refusal of workspace.prThread is covered by the safety table.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonClient } from '@shared/client'
import type { PrThread, PullRequest, Workspace } from '@shared/types'
import { runCli, runCliJson } from '../../src/testing/cli'
import { recordEvents, startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import {
  fakeCheckRun,
  fakeComment,
  fakeLineComment,
  fakeReview,
  fakeStatusContext,
  readFakeLog,
  setFakePullRequest
} from '../../src/testing/fakes'
import { addBareOrigin, makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon
let client: DaemonClient

beforeEach(async () => {
  daemon = await startTestDaemon({ config: 'pr_poll_seconds = 0.2\n' })
  client = daemon.client
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await daemon.close()
})

const opts = { timeout: 10_000 }
const prOf = async (id: string) => (await client.request('workspace.get', { id })).pr

const views = () =>
  readFakeLog(daemon.ghLog).filter((c) => c.argv[0] === 'pr' && c.argv[1] === 'view')

const apiCalls = () => readFakeLog(daemon.ghLog).filter((c) => c.argv[0] === 'api')

async function workspace(name = 'app-1520-pr-thread'): Promise<Workspace> {
  const repo = makeTempRepo(daemon.home)
  addBareOrigin(repo)
  const project = await client.request('project.add', { path: repo })

  return client.request('workspace.create', { projectId: project.id, name })
}

const UPDATED = '2026-10-14T03:30:00Z'

/** A workspace whose pull request #42 has two comments, a change request, and a line comment. */
async function workspaceWithThread(): Promise<Workspace> {
  const ws = await workspace()
  setFakePullRequest(daemon.ghPrs, ws.branch, {
    number: 42,
    url: 'https://github.com/rquellh/que/pull/42',
    title: 'Retry uploads with backoff',
    isDraft: false,
    updatedAt: UPDATED,
    comments: [
      fakeComment({
        author: 'mara',
        body: 'Can we cap the retries?',
        createdAt: '2026-10-14T03:00:00Z'
      }),
      fakeComment({ author: 'rquellh', body: 'Capped at five.', createdAt: '2026-10-14T03:20:00Z' })
    ],
    reviews: [
      fakeReview({
        author: 'jules',
        state: 'CHANGES_REQUESTED',
        body: 'Needs a backoff.',
        submittedAt: '2026-10-14T03:10:00Z'
      }),
      fakeReview({ author: 'jules', state: 'COMMENTED', submittedAt: '2026-10-14T03:05:00Z' })
    ],
    lineComments: [
      fakeLineComment({
        author: 'jules',
        body: 'Off by one here.',
        path: 'src/retry.ts',
        line: 12,
        createdAt: '2026-10-14T03:05:00Z'
      })
    ]
  })
  await expect.poll(async () => (await prOf(ws.id))?.updatedAt, opts).toBe(UPDATED)

  return ws
}

describe('workspace.prThread', () => {
  it('returns the conversation oldest first and caches it while the pull request holds still', async () => {
    const ws = await workspaceWithThread()

    const thread = await client.request('workspace.prThread', { id: ws.id })

    expect(thread).toMatchObject({ workspaceId: ws.id, number: 42 })
    expect(thread?.entries.map((e) => [e.kind, e.author, e.state, e.path, e.line])).toEqual([
      ['comment', 'mara', null, null, null],
      ['line', 'jules', null, 'src/retry.ts', 12],
      ['review', 'jules', 'changes_requested', null, null],
      ['comment', 'rquellh', null, null, null]
    ])
    expect(views().map((c) => c.argv)).toEqual([['pr', 'view', '42', '--json', 'comments,reviews']])
    expect(apiCalls().map((c) => [c.argv[1], c.cwd])).toEqual([
      ['repos/{owner}/{repo}/pulls/42/comments', ws.path]
    ])

    const again = await client.request('workspace.prThread', { id: ws.id })

    expect(again).toEqual(thread)
    expect(views()).toHaveLength(1)
  }, 30_000)

  it('fetches again once the tracker sees updatedAt move, and on refresh', async () => {
    const ws = await workspaceWithThread()
    await client.request('workspace.prThread', { id: ws.id })

    setFakePullRequest(daemon.ghPrs, ws.branch, {
      updatedAt: '2026-10-14T04:00:00Z',
      comments: [
        fakeComment({ author: 'mara', body: 'Thanks!', createdAt: '2026-10-14T04:00:00Z' })
      ],
      reviews: [],
      lineComments: []
    })
    await expect.poll(async () => (await prOf(ws.id))?.updatedAt, opts).toBe('2026-10-14T04:00:00Z')
    const changed = await client.request('workspace.prThread', { id: ws.id })

    expect(changed?.entries.map((e) => e.body)).toEqual(['Thanks!'])
    expect(views()).toHaveLength(2)

    await client.request('workspace.prThread', { id: ws.id, refresh: true })

    expect(views()).toHaveLength(3)
  }, 30_000)

  it('fails with gh_failed and leaves the stored pull request alone when gh fails', async () => {
    const ws = await workspaceWithThread()
    const before = await prOf(ws.id)
    vi.stubEnv('QUE_FAKE_GH_FAIL', '1')

    await expect(client.request('workspace.prThread', { id: ws.id })).rejects.toMatchObject({
      code: 'gh_failed',
      message: 'gh: failed (fake)'
    })

    expect((await prOf(ws.id))?.number).toBe(before?.number)
    expect((await prOf(ws.id))?.updatedAt).toBe(before?.updatedAt)
    vi.stubEnv('QUE_FAKE_GH_FAIL', '')
    const thread = await client.request('workspace.prThread', { id: ws.id })
    expect(thread?.entries).toHaveLength(4)
  }, 30_000)

  it('is null for a workspace without a pull request, not_found for an unknown one', async () => {
    const ws = await workspace()

    expect(await client.request('workspace.prThread', { id: ws.id })).toBeNull()
    await expect(
      client.request('workspace.prThread', { id: 'ws_missing00000' })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(views()).toEqual([])
  }, 30_000)
})

describe('check runs', () => {
  it('arrive through the tracker failing first, and a finished run updates the workspace', async () => {
    const ws = await workspace()
    const updates = recordEvents(client, 'workspace.updated')
    setFakePullRequest(daemon.ghPrs, ws.branch, {
      isDraft: false,
      updatedAt: UPDATED,
      statusCheckRollup: [
        fakeStatusContext({ context: 'deploy/preview', state: 'PENDING' }),
        fakeCheckRun({ name: 'unit tests', conclusion: 'FAILURE', workflowName: 'CI' }),
        fakeCheckRun({ name: 'e2e', status: 'IN_PROGRESS', workflowName: 'CI' })
      ]
    })

    await expect
      .poll(async () => (await prOf(ws.id))?.checkRuns.map((c) => [c.state, c.name]), opts)
      .toEqual([
        ['failing', 'unit tests'],
        ['pending', 'deploy/preview'],
        ['pending', 'e2e']
      ])
    expect((await prOf(ws.id))?.checks).toBe('failing')

    const seen = updates.length
    setFakePullRequest(daemon.ghPrs, ws.branch, {
      statusCheckRollup: [
        fakeStatusContext({ context: 'deploy/preview', state: 'PENDING' }),
        fakeCheckRun({ name: 'unit tests', conclusion: 'FAILURE', workflowName: 'CI' }),
        fakeCheckRun({ name: 'e2e', conclusion: 'SUCCESS', workflowName: 'CI' })
      ]
    })

    await expect
      .poll(
        () =>
          updates
            .slice(seen)
            .some(
              (w) =>
                w.id === ws.id &&
                w.pr?.checkRuns.some((c) => c.name === 'e2e' && c.state === 'passing')
            ),
        opts
      )
      .toBe(true)
    expect((await prOf(ws.id))?.updatedAt).toBe(UPDATED)
  }, 30_000)
})

describe('que ws pr', () => {
  it('prints the pull request, its checks, and the conversation', async () => {
    const ws = await workspaceWithThread()
    setFakePullRequest(daemon.ghPrs, ws.branch, {
      statusCheckRollup: [
        fakeCheckRun({
          name: 'unit tests',
          conclusion: 'FAILURE',
          workflowName: 'CI',
          startedAt: '2026-10-14T03:00:00Z',
          completedAt: '2026-10-14T03:01:21Z'
        }),
        fakeStatusContext({ context: 'deploy/preview', state: 'PENDING' })
      ]
    })
    await expect.poll(async () => (await prOf(ws.id))?.checks, opts).toBe('failing')

    const r = await runCli('ws', 'pr', ws.name)

    expect(r.code).toBe(0)
    expect(r.stdout.trimEnd().split('\n')).toEqual([
      '#42 open · Retry uploads with backoff',
      'https://github.com/rquellh/que/pull/42',
      `updated ${UPDATED}`,
      '',
      'checks',
      'failing  unit tests (CI)  1m 21s',
      'pending  deploy/preview',
      '',
      'thread',
      'mara · 2026-10-14T03:00:00Z · comment',
      '  Can we cap the retries?',
      'jules · 2026-10-14T03:05:00Z · line · src/retry.ts:12',
      '  Off by one here.',
      'jules · 2026-10-14T03:10:00Z · changes requested',
      '  Needs a backoff.',
      'rquellh · 2026-10-14T03:20:00Z · comment',
      '  Capped at five.'
    ])
  }, 30_000)

  it('prints { pr, thread } with --json, and refetches with --refresh', async () => {
    const ws = await workspaceWithThread()

    const out = await runCliJson<{ pr: PullRequest; thread: PrThread }>(
      'ws',
      'pr',
      ws.name,
      '--json'
    )

    await runCli('ws', 'pr', ws.name, '--refresh')

    expect(out.pr).toMatchObject({ number: 42, state: 'open', checkRuns: [] })
    expect(out.thread).toMatchObject({ workspaceId: ws.id, number: 42 })
    expect(out.thread.entries).toHaveLength(4)
    expect(views()).toHaveLength(2)
  }, 30_000)

  it('says no pull request and exits 0 when there is none', async () => {
    const ws = await workspace()

    const r = await runCli('ws', 'pr', ws.name)

    expect(r).toMatchObject({ code: 0, stdout: 'no pull request\n' })
  }, 30_000)
})
