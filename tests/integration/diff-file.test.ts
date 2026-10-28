// workspace.diffFile against real worktrees on a temp repo with a bare origin:
// one file's hunks of tokenized lines in each workspace.diff scope, the
// whitespace option, and the binary skip. Quiet-hours refusal is covered by the
// safety table; the line, token and mark rules by the daemon's logic tests.
import fs from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DiffLine, WorkspaceDiffFile, WorkspaceDiffFileParams } from '@shared/protocol'
import type { Workspace } from '@shared/types'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { addBareOrigin, gitIn, makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon
let ws: Workspace
let repo: string

beforeEach(async () => {
  daemon = await startTestDaemon()
  repo = makeTempRepo(daemon.home)
  addBareOrigin(repo)
  const project = await daemon.client.request('project.add', { path: repo })

  const created = await daemon.client.request('workspace.create', {
    projectId: project.id,
    name: 'app-1510-structured-diff'
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

const diffFile = (
  path: string,
  opts: Omit<WorkspaceDiffFileParams, 'id' | 'path'> = {}
): Promise<WorkspaceDiffFile> =>
  daemon.client.request('workspace.diffFile', { id: ws.id, path, ...opts })

function commitAll(message: string): void {
  gitIn(ws.path, 'add', '.')
  gitIn(ws.path, 'commit', '-m', message)
}

const lineText = (l: DiffLine): string => l.tokens.map((t) => t.text).join('')
const allLines = (f: WorkspaceDiffFile): DiffLine[] => f.hunks.flatMap((h) => h.lines)

const UPLOADER = [
  'export async function upload(file: Blob): Promise<void> {',
  '  const retries = 1',
  '  await send(file, { retries })',
  '}',
  ''
].join('\n')

describe('workspace.diffFile', () => {
  describe('scopes', () => {
    it('gives a file the branch added, uncommitted edit included, as tokenized added lines', async () => {
      fs.writeFileSync(join(ws.path, 'uploader.ts'), UPLOADER)
      commitAll('Add the uploader')
      fs.writeFileSync(join(ws.path, 'uploader.ts'), UPLOADER.replace('retries = 1', 'retries = 3'))

      const f = await diffFile('uploader.ts')

      expect(f).toMatchObject({
        workspaceId: ws.id,
        path: 'uploader.ts',
        from: null,
        status: 'added',
        base: 'origin/main',
        head: ws.branch,
        commit: null,
        whitespace: 'show',
        fullContext: true,
        language: 'typescript',
        skipped: null,
        additions: 4,
        deletions: 0
      })
      expect(allLines(f).map((l) => [l.kind, l.old, l.new, lineText(l)])).toEqual([
        ['added', null, 1, 'export async function upload(file: Blob): Promise<void> {'],
        ['added', null, 2, '  const retries = 3'],
        ['added', null, 3, '  await send(file, { retries })'],
        ['added', null, 4, '}']
      ])
      const first = allLines(f)[0]?.tokens ?? []
      expect(first.find((t) => t.text === 'upload')?.kind).toBe('fn')
      expect(first.find((t) => t.text === 'Blob')?.kind).toBe('type')
      expect(first.find((t) => t.text === '{')).toEqual({ text: '{', kind: 'punct', depth: 0 })
    })

    it('marks the changed word of a modified tracked file, every unchanged line kept as context', async () => {
      fs.writeFileSync(join(ws.path, 'uploader.ts'), UPLOADER)
      commitAll('Add the uploader')
      gitIn(ws.path, 'push', '--quiet', 'origin', `HEAD:main`)
      gitIn(ws.path, 'fetch', '--quiet', 'origin')
      fs.writeFileSync(join(ws.path, 'uploader.ts'), UPLOADER.replace('retries = 1', 'retries = 3'))

      const f = await diffFile('uploader.ts')

      expect(f).toMatchObject({ status: 'modified', fullContext: true, additions: 1, deletions: 1 })
      expect(f.hunks).toHaveLength(1)
      expect(allLines(f).map((l) => [l.kind, l.old, l.new])).toEqual([
        ['context', 1, 1],
        ['removed', 2, null],
        ['added', null, 2],
        ['context', 3, 3],
        ['context', 4, 4]
      ])
      expect(allLines(f).map((l) => l.tokens.filter((t) => t.mark).map((t) => t.text))).toEqual([
        [],
        ['1'],
        ['3'],
        [],
        []
      ])
    })

    it('gives an untracked file as all added lines', async () => {
      fs.writeFileSync(join(ws.path, 'notes.md'), '# Retry notes\n\nBack off twice.\n')

      const f = await diffFile('notes.md')

      expect(f).toMatchObject({
        status: 'untracked',
        language: 'markdown',
        additions: 3,
        deletions: 0
      })
      expect(allLines(f).map((l) => [l.kind, l.old, l.new, lineText(l)])).toEqual([
        ['added', null, 1, '# Retry notes'],
        ['added', null, 2, ''],
        ['added', null, 3, 'Back off twice.']
      ])
    })

    it("narrows to one commit's own change, leaving out the working tree", async () => {
      fs.writeFileSync(join(ws.path, 'uploader.ts'), UPLOADER)
      commitAll('Add the uploader')
      fs.writeFileSync(join(ws.path, 'uploader.ts'), UPLOADER.replace('retries = 1', 'retries = 3'))
      commitAll('Retry three times')
      const sha = gitIn(ws.path, 'rev-parse', 'HEAD')
      fs.writeFileSync(join(ws.path, 'uploader.ts'), UPLOADER.replace('retries = 1', 'retries = 9'))

      const f = await diffFile('uploader.ts', { commit: sha })

      expect(f).toMatchObject({ commit: sha, status: 'modified', additions: 1, deletions: 1 })
      expect(
        allLines(f)
          .filter((l) => l.kind !== 'context')
          .map(lineText)
      ).toEqual(['  const retries = 1', '  const retries = 3'])
    })

    it("compares another branch's committed file against its base", async () => {
      gitIn(ws.path, 'checkout', '--quiet', '-b', 'APP-1511-jitter')
      fs.writeFileSync(join(ws.path, 'jitter.ts'), 'export const jitterMs = 250\n')
      commitAll('Add jitter to the backoff')
      fs.appendFileSync(join(ws.path, 'jitter.ts'), 'export const loose = true\n')

      const f = await diffFile('jitter.ts', { base: 'main', head: 'APP-1511-jitter' })

      expect(f).toMatchObject({ head: 'APP-1511-jitter', status: 'added', additions: 1 })
      expect(allLines(f).map(lineText)).toEqual(['export const jitterMs = 250'])
    })
  })

  describe('whitespace', () => {
    it('hides an indentation-only change when asked to ignore whitespace', async () => {
      fs.writeFileSync(join(ws.path, 'uploader.ts'), UPLOADER)
      commitAll('Add the uploader')
      gitIn(ws.path, 'push', '--quiet', 'origin', 'HEAD:main')
      gitIn(ws.path, 'fetch', '--quiet', 'origin')
      fs.writeFileSync(
        join(ws.path, 'uploader.ts'),
        UPLOADER.replace('  const retries', '    const retries')
      )

      const shown = await diffFile('uploader.ts')
      const ignored = await diffFile('uploader.ts', { whitespace: 'ignore' })

      expect(shown).toMatchObject({ whitespace: 'show', additions: 1, deletions: 1 })
      expect(ignored).toMatchObject({ whitespace: 'ignore', additions: 0, deletions: 0 })
      expect(allLines(ignored).every((l) => l.kind === 'context')).toBe(true)
    })
  })

  describe('highlighting', () => {
    it('colours the middle line of a block comment as a comment', async () => {
      const source = [
        '/*',
        '  const notCode = "inside the comment"',
        '*/',
        'export const retries = 1',
        ''
      ].join('\n')

      fs.writeFileSync(join(ws.path, 'retry.ts'), source)
      commitAll('Add retry')
      gitIn(ws.path, 'push', '--quiet', 'origin', 'HEAD:main')
      gitIn(ws.path, 'fetch', '--quiet', 'origin')
      fs.writeFileSync(join(ws.path, 'retry.ts'), source.replace('retries = 1', 'retries = 3'))

      const f = await diffFile('retry.ts')
      const middle = allLines(f).find((l) => l.old === 2)

      expect(middle?.kind).toBe('context')
      expect(middle && lineText(middle)).toBe('  const notCode = "inside the comment"')
      expect(middle?.tokens.every((t) => t.kind === 'comment')).toBe(true)
    })
  })

  describe('skipped', () => {
    it('gives a binary file no hunks', async () => {
      fs.writeFileSync(join(ws.path, 'logo.bin'), Buffer.from([0, 1, 2, 0, 255]))
      commitAll('Add a logo')

      expect(await diffFile('logo.bin')).toMatchObject({
        status: 'added',
        skipped: 'binary',
        language: null,
        additions: 0,
        deletions: 0,
        hunks: []
      })
    })
  })

  describe('errors', () => {
    it('answers not_found for a path with no changes and bad_request for one outside the worktree', async () => {
      await expect(diffFile('README.md')).rejects.toMatchObject({ code: 'not_found' })
      await expect(diffFile('../uploader/README.md')).rejects.toMatchObject({
        code: 'bad_request'
      })
    })
  })
})
