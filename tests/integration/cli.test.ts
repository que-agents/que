// The real `que` CLI as a subprocess against the in-process daemon.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TermInfo } from '@shared/protocol'
import { runCli } from '../../src/testing/cli'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'

let daemon: TestDaemon

beforeEach(async () => {
  daemon = await startTestDaemon()
})

afterEach(async () => {
  await daemon.close()
})

describe('que term list', () => {
  it('prints every terminal as JSON with --json and exits 0', async () => {
    const { id } = await daemon.client.request('term.create', {
      file: '/bin/cat',
      name: 'uploader-shell',
      cwd: daemon.home,
      cols: 80,
      rows: 24
    })

    const r = await runCli('term', 'list', '--json')

    expect(r.code).toBe(0)
    const terms = JSON.parse(r.stdout) as TermInfo[]
    expect(terms).toHaveLength(1)
    expect(terms[0]).toEqual({
      id,
      name: 'uploader-shell',
      cwd: daemon.home,
      cols: 80,
      rows: 24,
      pid: expect.any(Number),
      alive: true,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    })
  }, 30_000)

  it('says so when there are no terminals', async () => {
    const r = await runCli('term', 'list')

    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('no terminals')
  }, 30_000)

  it('fails with a message when the daemon is not running', async () => {
    await daemon.server.close()

    const r = await runCli('term', 'list', '--json')

    expect(r.code).toBe(1)
    expect(r.stderr).toContain('que: daemon is not running')
  }, 30_000)
})
