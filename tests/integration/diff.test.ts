// workspace.diff and `que ws diff` against real worktrees on a temp repo with a
// bare origin: committed and uncommitted changes against the merge base.
// Quiet-hours refusal of workspace.diff is covered by the safety table.
import fs from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkspaceDiff } from '@shared/protocol'
import type { Workspace } from '@shared/types'
import { runCli } from '../../src/testing/cli'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { addBareOrigin, gitIn, makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon
let ws: Workspace

beforeEach(async () => {
  daemon = await startTestDaemon()
  const repo = makeTempRepo(daemon.home)
  addBareOrigin(repo)
  const project = await daemon.client.request('project.add', { path: repo })
  const created = await daemon.client.request('workspace.create', {
    projectId: project.id,
    name: 'app-1500-diff-view'
  })
  await expect
    .poll(async () => (await daemon.client.request('workspace.get', { id: created.id })).status, {
      timeout: 10_000
    })
    .not.toBe('preparing')
  ws = await daemon.client.request('workspace.get', { id: created.id })
}, 30_000)

afterEach(async () => {
  await daemon.close()
})

const diff = (): Promise<WorkspaceDiff> => daemon.client.request('workspace.diff', { id: ws.id })
const file = (d: WorkspaceDiff, path: string) => d.files.find((f) => f.path === path)

function commitAll(message: string): void {
  gitIn(ws.path, 'add', '.')
  gitIn(ws.path, 'commit', '-m', message)
}

describe('workspace.diff', () => {
  it('is empty against origin/main when nothing changed', async () => {
    const d = await diff()

    expect(d).toMatchObject({ base: 'origin/main', head: ws.branch, commitsAhead: 0, files: [] })
  })

  it('shows committed, then uncommitted and untracked changes against the base', async () => {
    fs.appendFileSync(join(ws.path, 'README.md'), 'a second line\n')
    fs.writeFileSync(join(ws.path, 'notes.txt'), 'one\ntwo\nthree\n')
    commitAll('Change readme, add notes')

    const committed = await diff()

    expect(committed.commitsAhead).toBe(1)
    expect(
      committed.files.map((f) => [f.path, f.status, f.additions, f.deletions, f.dirty])
    ).toEqual([
      ['README.md', 'modified', 1, 0, false],
      ['notes.txt', 'added', 3, 0, false]
    ])
    expect(file(committed, 'README.md')?.patch).toContain('+a second line')

    fs.appendFileSync(join(ws.path, 'README.md'), 'a third line\n')
    fs.writeFileSync(join(ws.path, 'scratch.txt'), 'x\ny\n')

    const dirty = await diff()

    expect(file(dirty, 'README.md')).toMatchObject({ dirty: true, additions: 2, deletions: 0 })
    expect(file(dirty, 'README.md')?.patch).toContain('+a third line')
    expect(file(dirty, 'notes.txt')?.dirty).toBe(false)
    expect(file(dirty, 'scratch.txt')).toMatchObject({
      status: 'untracked',
      additions: 2,
      deletions: 0,
      dirty: true
    })
    expect(file(dirty, 'scratch.txt')?.patch).toContain('--- /dev/null')
    expect(file(dirty, 'scratch.txt')?.patch).toContain('+x')
  })

  it('reports a committed rename with its source', async () => {
    gitIn(ws.path, 'mv', 'README.md', 'GUIDE.md')
    commitAll('Rename readme')

    const d = await diff()

    expect(d.files).toHaveLength(1)
    expect(d.files[0]).toMatchObject({
      path: 'GUIDE.md',
      from: 'README.md',
      status: 'renamed',
      dirty: false
    })
  })

  it('gives a committed binary file no patch and no counts', async () => {
    fs.writeFileSync(join(ws.path, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255]))
    commitAll('Add a binary')

    expect(file(await diff(), 'blob.bin')).toMatchObject({
      status: 'added',
      additions: 0,
      deletions: 0,
      patch: null
    })
  })

  it('gives an untracked binary file no patch', async () => {
    fs.writeFileSync(join(ws.path, 'raw.bin'), Buffer.from([0, 9, 0]))

    expect(file(await diff(), 'raw.bin')).toMatchObject({ status: 'untracked', patch: null })
  })

  it('answers not_found for an unknown workspace', async () => {
    await expect(
      daemon.client.request('workspace.diff', { id: 'ws_missing' })
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('que ws diff', () => {
  it('prints the header, one line per file, and * for dirty ones', async () => {
    fs.appendFileSync(join(ws.path, 'README.md'), 'more\n')
    fs.writeFileSync(join(ws.path, 'new.txt'), 'a\nb\n')
    commitAll('Change readme, add new')
    fs.writeFileSync(join(ws.path, 'loose.txt'), 'z\n')

    const r = await runCli('ws', 'diff', ws.name)

    expect(r.code).toBe(0)
    expect(r.stdout.trim().split('\n')).toEqual([
      `${ws.branch} vs origin/main · 1 commits ahead`,
      'M README.md  +1 -0',
      '? loose.txt  +1 -0 *',
      'A new.txt  +2 -0'
    ])
  }, 30_000)

  it('says no changes, and prints the WorkspaceDiff with --json', async () => {
    const text = await runCli('ws', 'diff', ws.name)
    const json = await runCli('ws', 'diff', ws.name, '--json')

    expect(text.stdout.trim().split('\n')[1]).toBe('no changes')
    expect(JSON.parse(json.stdout)).toMatchObject({
      workspaceId: ws.id,
      base: 'origin/main',
      commitsAhead: 0,
      files: []
    })
  }, 30_000)
})
