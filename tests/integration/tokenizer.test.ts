// workspace.diffFile's tokenizer worker thread when it fails: a worker that
// crashes or hangs on a file gives that file plain tokens, never a failed
// request, and is replaced for the next one. The daemon runs the test-only
// fault worker (src/testing/fault-tokenizer-worker.ts), switched by
// QUE_TEST_TOKENIZER_FAULT; colouring through the real worker bundle is
// covered by diff-file.test.ts.
import fs from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffLine, WorkspaceDiffFile } from '@shared/protocol'
import type { Workspace } from '@shared/types'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon
let ws: Workspace

beforeEach(async () => {
  daemon = await startTestDaemon({ tokenizeTimeoutMs: 1_000, faultyTokenizer: true })
  const repo = makeTempRepo(daemon.home)
  const project = await daemon.client.request('project.add', { path: repo })

  const created = await daemon.client.request('workspace.create', {
    projectId: project.id,
    name: 'app-1520-tokenizer-worker'
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

const diffFile = (path: string): Promise<WorkspaceDiffFile> =>
  daemon.client.request('workspace.diffFile', { id: ws.id, path })

const tokensOf = (f: WorkspaceDiffFile): DiffLine['tokens'] =>
  f.hunks.flatMap((h) => h.lines).flatMap((l) => l.tokens)

const RETRY = 'export const retries = 3\n'

describe('tokenizer worker', () => {
  it('gives plain tokens for a file the worker crashes on, and colours the next file', async () => {
    vi.stubEnv('QUE_TEST_TOKENIZER_FAULT', 'throw:QUE_CRASH_4b2d')
    fs.writeFileSync(join(ws.path, 'crash.ts'), "export const marker = 'QUE_CRASH_4b2d'\n")
    fs.writeFileSync(join(ws.path, 'retry.ts'), RETRY)

    const crashed = await diffFile('crash.ts')

    expect(crashed).toMatchObject({ language: null, additions: 1 })
    expect(tokensOf(crashed)).toEqual([
      { text: "export const marker = 'QUE_CRASH_4b2d'", kind: 'plain' }
    ])

    const next = await diffFile('retry.ts')

    expect(next.language).toBe('typescript')
  }, 20_000)

  it('gives plain tokens for a file the worker hangs on, after the timeout, and colours the next file', async () => {
    vi.stubEnv('QUE_TEST_TOKENIZER_FAULT', 'hang:QUE_HANG_7c1e')
    fs.writeFileSync(join(ws.path, 'hang.ts'), "export const marker = 'QUE_HANG_7c1e'\n")
    fs.writeFileSync(join(ws.path, 'retry.ts'), RETRY)

    const hung = await diffFile('hang.ts')

    expect(hung.language).toBeNull()
    expect(tokensOf(hung).every((t) => t.kind === 'plain')).toBe(true)

    const next = await diffFile('retry.ts')

    expect(next.language).toBe('typescript')
  }, 20_000)
})
