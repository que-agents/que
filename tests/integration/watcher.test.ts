// The worktree watcher on the in-process daemon against real linked worktrees
// of a temp repo: a workspace is watched while a client asks to watch it
// (workspace.watch), whatever terminals are attached, and a change in its
// worktree or a commit sends one workspace.changed. Exactness is shown with a sentinel: a second watched
// workspace's change is written after the first one's, so its event arrives
// after any event the first change could still produce.
import fs from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DaemonClient } from '@shared/client'
import type { Workspace } from '@shared/types'
import { recordEvents, startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { gitIn, makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon
let repo: string
let projectId: string
let changed: string[]

beforeEach(async () => {
  daemon = await startTestDaemon()
  repo = makeTempRepo(daemon.home)
  projectId = (await daemon.client.request('project.add', { path: repo })).id
  changed = []
  daemon.client.on('workspace.changed', ({ id }) => changed.push(id))
}, 30_000)

afterEach(async () => {
  await daemon.close()
})

async function createWorkspace(name: string): Promise<Workspace> {
  const created = await daemon.client.request('workspace.create', { projectId, name })
  await expect
    .poll(async () => (await daemon.client.request('workspace.get', { id: created.id })).status, {
      timeout: 10_000
    })
    .not.toBe('preparing')

  return daemon.client.request('workspace.get', { id: created.id })
}

/** Opens the workspace's terminal and attaches to it, as a window does. */
async function attach(ws: Workspace): Promise<string> {
  const { id } = await daemon.client.request('workspace.openTerminal', {
    id: ws.id,
    cols: 80,
    rows: 24
  })

  await daemon.client.request('term.attach', { id, cols: 80, rows: 24 })

  return id
}

/** Asks the daemon to watch the workspace, as a window showing it does. */
async function watch(ws: Workspace): Promise<void> {
  await daemon.client.request('workspace.watch', { id: ws.id })
}

const count = (id: string): number => changed.filter((x) => x === id).length

/**
 * Writes a file in the sentinel's worktree and waits for its next event. Any
 * event from an earlier change elsewhere has arrived by then.
 */
async function sentinel(ws: Workspace, file: string): Promise<void> {
  const before = count(ws.id)
  fs.writeFileSync(join(ws.path, file), 'sentinel\n')
  await expect.poll(() => count(ws.id), { timeout: 10_000 }).toBeGreaterThan(before)
}

/**
 * Watches `ws` and `other` with workspace.watch, then settles. The system
 * starts a new watch asynchronously, so a write right after the watch can go unseen: the
 * sentinel file is rewritten on every poll until `other` reports a change,
 * which shows the watches (started before it, on the same event stream) are
 * live and that events from writes made earlier (setup, staging) have
 * arrived. Returns the count of `ws` events to measure from.
 */
async function watchBoth(
  ws: Workspace,
  other: Workspace,
  start: (w: Workspace) => Promise<void> = watch
): Promise<number> {
  await start(ws)
  await start(other)
  const before = count(other.id)
  let nudge = 0
  await expect
    .poll(
      () => {
        nudge += 1
        fs.writeFileSync(join(other.path, 'settle.txt'), `settle ${nudge}\n`)

        return count(other.id)
      },
      { timeout: 10_000, interval: 200 }
    )
    .toBeGreaterThan(before)
  await sentinel(other, 'settled.txt')

  return count(ws.id)
}

describe('worktree watcher', () => {
  describe('changes', () => {
    it('sends one workspace.changed for a new file in the worktree', async () => {
      const ws = await createWorkspace('app-1601-watch-files')
      const other = await createWorkspace('app-1602-sentinel')
      const base = await watchBoth(ws, other)
      expect(daemon.server.watcher.watching().sort()).toEqual([ws.id, other.id].sort())

      fs.mkdirSync(join(ws.path, 'src'))
      fs.writeFileSync(join(ws.path, 'src/retry.ts'), 'export const retries = 3\n')

      await expect.poll(() => count(ws.id), { timeout: 10_000 }).toBe(base + 1)
      await sentinel(other, 'one.txt')
      expect(count(ws.id)).toBe(base + 1)
    }, 30_000)

    it('sends one workspace.changed for a commit', async () => {
      const ws = await createWorkspace('app-1603-watch-commit')
      const other = await createWorkspace('app-1604-sentinel')
      fs.writeFileSync(join(ws.path, 'notes.txt'), 'retry on 503\n')
      gitIn(ws.path, 'add', 'notes.txt')
      const base = await watchBoth(ws, other)

      gitIn(ws.path, 'commit', '-m', 'Add notes')

      await expect.poll(() => count(ws.id), { timeout: 10_000 }).toBe(base + 1)
      await sentinel(other, 'one.txt')
      expect(count(ws.id)).toBe(base + 1)
    }, 30_000)

    it('re-reads the branch when HEAD moves, before workspace.changed', async () => {
      const ws = await createWorkspace('app-1607-watch-branch')
      const other = await createWorkspace('app-1608-sentinel')
      const base = await watchBoth(ws, other)
      const updates = recordEvents(daemon.client, 'workspace.updated')

      gitIn(ws.path, 'checkout', '--quiet', '-b', 'fix/upload-timeout')

      await expect.poll(() => count(ws.id), { timeout: 10_000 }).toBe(base + 1)
      expect(updates.some((w) => w.id === ws.id && w.branch === 'fix/upload-timeout')).toBe(true)
      expect((await daemon.client.request('workspace.get', { id: ws.id })).branch).toBe(
        'fix/upload-timeout'
      )
    }, 30_000)

    it('ignores object writes in the repository and the worktree gitdir', async () => {
      const ws = await createWorkspace('app-1605-watch-objects')
      const other = await createWorkspace('app-1606-sentinel')
      const base = await watchBoth(ws, other)
      const gitdir = gitIn(ws.path, 'rev-parse', '--absolute-git-dir')

      fs.mkdirSync(join(repo, '.git/objects/7f'), { recursive: true })
      fs.writeFileSync(join(repo, '.git/objects/7f/3a9c'), 'object')
      fs.mkdirSync(join(gitdir, 'objects/7f'), { recursive: true })
      fs.writeFileSync(join(gitdir, 'objects/7f/3a9c'), 'object')
      fs.writeFileSync(join(gitdir, 'COMMIT_EDITMSG'), 'Add notes\n')
      await sentinel(other, 'one.txt')
      expect(count(ws.id)).toBe(base)

      fs.writeFileSync(join(ws.path, 'notes.txt'), 'retry on 503\n')
      await expect.poll(() => count(ws.id), { timeout: 10_000 }).toBe(base + 1)
    }, 30_000)
  })

  describe('workspace.watch', () => {
    it('watches a workspace with no terminal attached and sends one event for a write', async () => {
      const ws = await createWorkspace('app-1611-watch-shown')
      const other = await createWorkspace('app-1612-sentinel')
      const base = await watchBoth(ws, other)
      expect(daemon.server.watcher.watching().sort()).toEqual([ws.id, other.id].sort())

      fs.writeFileSync(join(ws.path, 'notes.txt'), 'retry on 503\n')

      await expect.poll(() => count(ws.id), { timeout: 10_000 }).toBe(base + 1)
      await sentinel(other, 'one.txt')
      expect(count(ws.id)).toBe(base + 1)
    }, 30_000)

    it('stops watching on workspace.unwatch', async () => {
      const ws = await createWorkspace('app-1613-watch-unwatch')
      await watch(ws)
      expect(daemon.server.watcher.watching()).toEqual([ws.id])

      await daemon.client.request('workspace.unwatch', { id: ws.id })

      expect(daemon.server.watcher.watching()).toEqual([])
    }, 30_000)

    it('stops watching after workspace.unwatch even while a terminal is attached', async () => {
      const ws = await createWorkspace('app-1614-watch-both')
      const other = await createWorkspace('app-1616-sentinel')
      await attach(ws)
      await watchBoth(ws, other)

      await daemon.client.request('workspace.unwatch', { id: ws.id })
      expect(daemon.server.watcher.watching()).toEqual([other.id])
      const base = count(ws.id)
      fs.writeFileSync(join(ws.path, 'notes.txt'), 'retry on 503\n')

      await sentinel(other, 'one.txt')
      expect(count(ws.id)).toBe(base)
    }, 30_000)

    it('stops watching when the watching connection closes', async () => {
      const ws = await createWorkspace('app-1615-watch-close')
      const window = new DaemonClient(daemon.socket)
      await window.connect()
      await window.request('workspace.watch', { id: ws.id })
      expect(daemon.server.watcher.watching()).toEqual([ws.id])

      window.close()

      await expect.poll(() => daemon.server.watcher.watching(), { timeout: 10_000 }).toEqual([])
    }, 30_000)

    it('answers not_found for an unknown workspace', async () => {
      await expect(
        daemon.client.request('workspace.watch', { id: 'ws_missing' })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(daemon.server.watcher.watching()).toEqual([])
    })
  })

  describe('lifecycle', () => {
    it('does not watch a workspace just because a terminal of it is attached', async () => {
      const ws = await createWorkspace('app-1607-watch-attach')
      const other = await createWorkspace('app-1617-sentinel')
      await attach(ws)
      await watch(other)
      expect(daemon.server.watcher.watching()).toEqual([other.id])

      fs.writeFileSync(join(ws.path, 'notes.txt'), 'retry on 503\n')

      // The watch on `other` starts asynchronously: rewrite its file until an
      // event arrives, which comes after anything the write above could cause.
      let nudge = 0
      await expect
        .poll(
          () => {
            nudge += 1
            fs.writeFileSync(join(other.path, 'settle.txt'), `settle ${nudge}\n`)

            return count(other.id)
          },
          { timeout: 10_000, interval: 200 }
        )
        .toBeGreaterThan(0)
      await sentinel(other, 'one.txt')
      expect(count(ws.id)).toBe(0)
    }, 30_000)

    it('stops watching when the watching connection closes after a terminal attach', async () => {
      const ws = await createWorkspace('app-1610-watch-close')

      const { id: termId } = await daemon.client.request('workspace.openTerminal', {
        id: ws.id,
        cols: 80,
        rows: 24
      })

      const window = new DaemonClient(daemon.socket)
      await window.connect()
      await window.request('term.attach', { id: termId, cols: 80, rows: 24 })
      await window.request('workspace.watch', { id: ws.id })
      expect(daemon.server.watcher.watching()).toEqual([ws.id])

      window.close()

      await expect.poll(() => daemon.server.watcher.watching(), { timeout: 10_000 }).toEqual([])
    }, 30_000)

    it('stops watching when the workspace is removed', async () => {
      const ws = await createWorkspace('app-1609-watch-remove')
      await watch(ws)
      expect(daemon.server.watcher.watching()).toEqual([ws.id])

      await daemon.client.request('workspace.remove', { id: ws.id, deleteBranch: false })

      await expect.poll(() => daemon.server.watcher.watching(), { timeout: 10_000 }).toEqual([])
    }, 30_000)
  })
})
