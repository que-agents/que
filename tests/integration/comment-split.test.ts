// workspace.diff's split of each file's changed lines into code and comment
// lines, and workspace.diffFile's per-line comment flags, against real
// worktrees on a temp repo with a bare origin. The daemon here gives the split
// no time inside the answer, so every split misses the first answer and the
// order is fixed: an all-code answer, workspace.changed, then the split from
// the cache. Which lines are comment lines is covered by the logic tests.
import fs from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DiffLine, WorkspaceDiff } from '@shared/protocol'
import type { Workspace } from '@shared/types'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { addBareOrigin, gitIn, makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon
let ws: Workspace
let changed: string[]

beforeEach(async () => {
  daemon = await startTestDaemon({ classifyBudgetMs: 0 })
  const repo = makeTempRepo(daemon.home)
  addBareOrigin(repo)
  const project = await daemon.client.request('project.add', { path: repo })

  const created = await daemon.client.request('workspace.create', {
    projectId: project.id,
    name: 'app-1530-comment-split'
  })

  await expect
    .poll(async () => (await daemon.client.request('workspace.get', { id: created.id })).status, {
      timeout: 10_000
    })
    .not.toBe('preparing')
  ws = await daemon.client.request('workspace.get', { id: created.id })
  changed = []
  daemon.client.on('workspace.changed', ({ id }) => changed.push(id))
}, 30_000)

afterEach(async () => {
  await daemon.close()
})

const diff = (): Promise<WorkspaceDiff> => daemon.client.request('workspace.diff', { id: ws.id })

function commitAll(message: string): void {
  gitIn(ws.path, 'add', '.')
  gitIn(ws.path, 'commit', '-m', message)
}

/** Commits `files` and makes them the base, so the next edits are modifications. */
function baseline(files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(join(ws.path, name), text)
  commitAll('Add the uploader')
  gitIn(ws.path, 'push', '--quiet', 'origin', 'HEAD:main')
  gitIn(ws.path, 'fetch', '--quiet', 'origin')
}

const lineText = (l: DiffLine): string => l.tokens.map((t) => t.text).join('')

/** A unique tag per test: splits are cached by content, so no test sees another's. */
const tag = (): string => Math.random().toString(36).slice(2)

describe('comment split', () => {
  it('reports a comment-only file and a code file with their split counts', async () => {
    const id = tag()

    const backoff = [
      `// Backoff for upload ${id}.`,
      'export function backoffMs(attempt: number): number {',
      '  return 250 * 2 ** attempt',
      '}',
      ''
    ].join('\n')

    const retry = ['/**', ` * Retries for ${id}.`, ' */', 'export const retries = 1', ''].join('\n')
    baseline({ 'backoff.ts': backoff, 'retry.ts': retry })

    // backoff.ts: one comment line reworded, a block comment added over two lines and a blank.
    fs.writeFileSync(
      join(ws.path, 'backoff.ts'),
      backoff
        .replace('// Backoff for', '// Exponential backoff for')
        .replace(
          'export function',
          [
            '/*',
            ' * Doubles each attempt.',
            '',
            ' * Never jittered.',
            ' */',
            'export function'
          ].join('\n')
        )
    )

    // retry.ts: the doc comment reworded and the value changed.
    fs.writeFileSync(
      join(ws.path, 'retry.ts'),
      retry.replace('Retries for', 'How many retries for').replace('= 1', '= 3')
    )
    commitAll('Document the backoff, retry three times')

    await expect
      .poll(async () => (await diff()).files.find((f) => f.path === 'backoff.ts')?.commentOnly, {
        timeout: 10_000
      })
      .toBe(true)
    const d = await diff()

    expect(d.files.find((f) => f.path === 'backoff.ts')).toMatchObject({
      commentOnly: true,
      additions: 6,
      deletions: 1,
      codeAdditions: 0,
      commentAdditions: 6,
      codeDeletions: 0,
      commentDeletions: 1
    })
    expect(d.files.find((f) => f.path === 'retry.ts')).toMatchObject({
      commentOnly: false,
      additions: 2,
      deletions: 2,
      codeAdditions: 1,
      commentAdditions: 1,
      codeDeletions: 1,
      commentDeletions: 1
    })

    const lines = (
      await daemon.client.request('workspace.diffFile', { id: ws.id, path: 'retry.ts' })
    ).hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.kind !== 'context')

    expect(lines.map((l) => [l.kind, lineText(l), l.comment === true])).toEqual([
      ['removed', ` * Retries for ${id}.`, true],
      ['added', ` * How many retries for ${id}.`, true],
      ['removed', 'export const retries = 1', false],
      ['added', 'export const retries = 3', false]
    ])
  })

  it('splits uncommitted and untracked files in the working tree', async () => {
    const id = tag()
    baseline({ 'retry.ts': `export const retries = 1 // ${id}\n` })
    fs.writeFileSync(
      join(ws.path, 'retry.ts'),
      `// Three, see ${id}.\nexport const retries = 1 // ${id}\n`
    )
    fs.writeFileSync(join(ws.path, 'notes.py'), `# Upload notes ${id}\n# Retry with backoff.\n`)

    await expect
      .poll(
        async () =>
          (await diff()).files.map((f) => [f.path, f.status, f.commentOnly, f.commentAdditions]),
        { timeout: 10_000 }
      )
      .toEqual([
        ['notes.py', 'untracked', true, 2],
        ['retry.ts', 'modified', true, 1]
      ])
  })

  it('answers all code at first and sends workspace.changed once the split is ready', async () => {
    const id = tag()
    baseline({ 'retry.ts': 'export const retries = 1\n' })
    fs.writeFileSync(join(ws.path, 'retry.ts'), `// Fixed for ${id}.\nexport const retries = 1\n`)

    const first = await diff()

    expect(first.files).toEqual([
      expect.objectContaining({
        path: 'retry.ts',
        commentOnly: false,
        codeAdditions: 1,
        commentAdditions: 0
      })
    ])
    await expect.poll(() => changed, { timeout: 10_000 }).toEqual([ws.id])
    expect((await diff()).files).toEqual([
      expect.objectContaining({ commentOnly: true, codeAdditions: 0, commentAdditions: 1 })
    ])
  })

  it('counts a file in a language without a grammar as code', async () => {
    const id = tag()
    baseline({ 'retry.conf': 'retries = 1\n' })
    fs.writeFileSync(join(ws.path, 'retry.conf'), `# Fixed for ${id}.\nretries = 1\n`)

    expect((await diff()).files).toEqual([
      expect.objectContaining({ path: 'retry.conf', commentOnly: false, codeAdditions: 1 })
    ])
    expect(changed).toEqual([])
  })
})
