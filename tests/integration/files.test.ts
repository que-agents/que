// workspace.files, workspace.readFile and `que ws files` against a real worktree
// on a temp repo: what is listed, what is read, and the paths refused.
// Quiet-hours refusal of both methods is covered by the safety table.
import fs from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ErrorCodes, type WorkspaceFiles } from '@shared/protocol'
import type { Workspace } from '@shared/types'
import { MAX_FILE_CHARS } from '@daemon/files'
import { runCli } from '../../src/testing/cli'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { gitIn, makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon
let ws: Workspace

const EXPECTED_FILES = [
  '.gitignore',
  'README.md',
  'link-out',
  'notes.txt',
  'que.toml',
  'src/app/main.ts',
  'src/staged.ts'
]

beforeEach(async () => {
  daemon = await startTestDaemon()
  const repo = makeTempRepo(daemon.home)
  const project = await daemon.client.request('project.add', { path: repo })
  const created = await daemon.client.request('workspace.create', {
    projectId: project.id,
    name: 'app-1600-files-tab'
  })
  await expect
    .poll(async () => (await daemon.client.request('workspace.get', { id: created.id })).status, {
      timeout: 10_000
    })
    .not.toBe('preparing')
  ws = await daemon.client.request('workspace.get', { id: created.id })

  // Committed: a .gitignore and a nested file.
  fs.writeFileSync(join(ws.path, '.gitignore'), 'build/\n')
  fs.mkdirSync(join(ws.path, 'src/app'), { recursive: true })
  fs.writeFileSync(join(ws.path, 'src/app/main.ts'), 'export const retries = 3\n')
  gitIn(ws.path, 'add', '.')
  gitIn(ws.path, 'commit', '-m', 'Add main and ignore build')
  // Staged, then modified again: listed once.
  fs.writeFileSync(join(ws.path, 'src/staged.ts'), 'export const a = 1\n')
  gitIn(ws.path, 'add', 'src/staged.ts')
  fs.appendFileSync(join(ws.path, 'src/staged.ts'), 'export const b = 2\n')
  // Untracked.
  fs.writeFileSync(join(ws.path, 'notes.txt'), 'retry on 503\n')
  // Ignored.
  fs.mkdirSync(join(ws.path, 'build'))
  fs.writeFileSync(join(ws.path, 'build/bundle.js'), 'console.log(1)\n')
  // A symlink beside .git pointing outside the worktree.
  const outside = join(daemon.home, 'outside-secret.txt')
  fs.writeFileSync(outside, 'not for the file view\n')
  fs.symlinkSync(outside, join(ws.path, 'link-out'))
}, 30_000)

afterEach(async () => {
  await daemon.close()
})

const read = (path: string) => daemon.client.request('workspace.readFile', { id: ws.id, path })

describe('workspace.files', () => {
  it('lists committed, staged and untracked files, sorted, without the ignored ones', async () => {
    const listing = await daemon.client.request('workspace.files', { id: ws.id })

    expect(listing).toMatchObject({ workspaceId: ws.id, truncated: false })
    expect(listing.files).toEqual(EXPECTED_FILES)
    expect(Number.isNaN(Date.parse(listing.generatedAt))).toBe(false)
  })

  it('answers not_found for an unknown workspace', async () => {
    await expect(
      daemon.client.request('workspace.files', { id: 'ws_missing' })
    ).rejects.toMatchObject({ code: ErrorCodes.NotFound })
  })
})

describe('workspace.readFile', () => {
  it('returns a text file with its byte size', async () => {
    const content = 'export const retries = 3\n// délai\n'
    fs.writeFileSync(join(ws.path, 'src/app/main.ts'), content)

    expect(await read('src/app/main.ts')).toEqual({
      workspaceId: ws.id,
      path: 'src/app/main.ts',
      content,
      binary: false,
      size: Buffer.byteLength(content),
      truncated: false
    })
  })

  it('normalizes a leading ./ in the path', async () => {
    expect((await read('./notes.txt')).path).toBe('notes.txt')
  })

  it('marks a file holding a NUL binary, with no content', async () => {
    fs.writeFileSync(join(ws.path, 'logo.png'), Buffer.from([0x89, 0x50, 0, 0x47, 0xff]))

    expect(await read('logo.png')).toMatchObject({
      content: null,
      binary: true,
      size: 5,
      truncated: false
    })
  })

  it('cuts a file over the cap at exactly MAX_FILE_CHARS characters', async () => {
    fs.writeFileSync(join(ws.path, 'big.log'), 'x'.repeat(MAX_FILE_CHARS + 1234))

    const f = await read('big.log')

    expect(f.truncated).toBe(true)
    expect(f.binary).toBe(false)
    expect(f.content).toHaveLength(MAX_FILE_CHARS)
    expect(f.size).toBe(MAX_FILE_CHARS + 1234)
  })

  it.each([['../x'], ['/etc/passwd'], ['link-out'], ['src/app'], ['.']])(
    'refuses %j as bad_request',
    async (path) => {
      await expect(read(path)).rejects.toMatchObject({ code: ErrorCodes.BadRequest })
    }
  )

  it('answers not_found for a missing path', async () => {
    await expect(read('src/app/missing.ts')).rejects.toMatchObject({ code: ErrorCodes.NotFound })
    await expect(read('notes.txt/inner')).rejects.toMatchObject({ code: ErrorCodes.NotFound })
  })
})

describe('que ws files', () => {
  it('prints one path per line, and the whole result with --json', async () => {
    const text = await runCli('ws', 'files', ws.name)
    const json = await runCli('ws', 'files', ws.name, '--json')

    expect(text.code).toBe(0)
    expect(text.stdout.trim().split('\n')).toEqual(EXPECTED_FILES)
    expect(json.code).toBe(0)
    const parsed = JSON.parse(json.stdout) as WorkspaceFiles
    expect(parsed).toMatchObject({ workspaceId: ws.id, files: EXPECTED_FILES, truncated: false })
  })
})
