// Terminals over the real socket: real node-pty, the headless mirror, and the
// real DaemonClient against an in-process DaemonServer (migrated from the
// first work package's pty-host and server tests).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DaemonClient } from '@shared/client'
import { recordEvents, startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'

let daemon: TestDaemon
let client: DaemonClient

beforeEach(async () => {
  daemon = await startTestDaemon()
  client = daemon.client
})

afterEach(async () => {
  await daemon.close()
})

/** Collects every payload of one event on a client, in arrival order. */
describe('terminals', () => {
  describe('output', () => {
    it('mirrors program output into the snapshot and reports the exit code', async () => {
      const exits = recordEvents(client, 'term.exit')

      const { id } = await client.request('term.create', {
        file: '/bin/sh',
        args: ['-c', 'printf "QUE_MIRROR_4b1e\\n"; exit 3'],
        cols: 80,
        rows: 24
      })

      await expect
        .poll(async () => (await client.request('term.snapshot', { id })).text, { timeout: 10_000 })
        .toContain('QUE_MIRROR_4b1e')
      expect((await client.request('term.snapshot', { id })).serialized).toContain(
        'QUE_MIRROR_4b1e'
      )

      await expect
        .poll(() => exits, { timeout: 10_000 })
        .toContainEqual(expect.objectContaining({ id, exitCode: 3 }))
      const listed = await client.request('term.list')
      expect(listed.find((t) => t.id === id)).toMatchObject({ alive: false })
    }, 20_000)

    it('streams live output to an attached client', async () => {
      const data = recordEvents(client, 'term.data')
      const { id } = await client.request('term.create', { file: '/bin/cat', cols: 80, rows: 24 })
      await client.request('term.attach', { id, cols: 80, rows: 24 })

      await client.request('term.write', { id, data: 'QUE_STREAM_91c0\n' })

      await expect
        .poll(
          () =>
            data
              .filter((d) => d.id === id)
              .map((d) => d.data)
              .join(''),
          { timeout: 10_000 }
        )
        .toContain('QUE_STREAM_91c0')
    }, 20_000)
  })

  describe('environment', () => {
    it("starts a shell without the launching terminal's identity or an agent session's markers", async () => {
      // As when the daemon was started from a shell inside another terminal
      // emulator, by an agent's tool: none of that belongs to a new terminal.
      vi.stubEnv('TERM_PROGRAM', 'kitty')
      vi.stubEnv('KITTY_WINDOW_ID', '3')
      vi.stubEnv('CLAUDECODE', '1')
      vi.stubEnv('CLAUDE_CODE_CHILD_SESSION', '1')
      vi.stubEnv('CLAUDE_CONFIG_DIR', '/Users/dev/.claude-work')

      const { id } = await client.request('term.create', {
        file: '/bin/sh',
        args: [
          '-c',
          'env | grep -E "^(TERM|TERM_PROGRAM|KITTY_WINDOW_ID|CLAUDECODE|CLAUDE_CODE_CHILD_SESSION|CLAUDE_CONFIG_DIR|QUE_TERMINAL)=" | sort; echo QUE_ENV_END'
        ],
        cols: 80,
        rows: 24
      })

      await expect
        .poll(async () => (await client.request('term.snapshot', { id })).text, { timeout: 10_000 })
        .toContain('QUE_ENV_END')

      const lines = (await client.request('term.snapshot', { id })).text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.includes('='))

      expect(lines).toEqual([
        'CLAUDE_CONFIG_DIR=/Users/dev/.claude-work',
        'QUE_TERMINAL=1',
        'TERM=xterm-256color'
      ])
    })
  })

  describe('attach', () => {
    it('replays the screen to a client that attaches after the output was written', async () => {
      const { id } = await client.request('term.create', {
        cols: 80,
        rows: 24,
        file: '/bin/sh',
        args: ['-c', 'printf QUE_ATTACH_7f3a; sleep 30']
      })

      await expect
        .poll(async () => (await client.request('term.snapshot', { id })).text, { timeout: 10_000 })
        .toContain('QUE_ATTACH_7f3a')

      const late = new DaemonClient(daemon.socket)
      await late.connect()
      const { snapshot } = await late.request('term.attach', { id, cols: 80, rows: 24 })
      late.close()

      expect(snapshot).toContain('QUE_ATTACH_7f3a')
    }, 20_000)

    it('stops streaming to a client once it detaches', async () => {
      const data = recordEvents(client, 'term.data')
      const { id } = await client.request('term.create', { file: '/bin/cat', cols: 80, rows: 24 })
      await client.request('term.attach', { id, cols: 80, rows: 24 })
      await client.request('term.write', { id, data: 'QUE_BEFORE_d2a8\n' })
      await expect
        .poll(() => data.map((d) => d.data).join(''), { timeout: 10_000 })
        .toContain('QUE_BEFORE_d2a8')

      await client.request('term.detach', { id })
      const seenBefore = data.length
      await client.request('term.write', { id, data: 'QUE_AFTER_5e17\n' })

      await expect
        .poll(async () => (await client.request('term.snapshot', { id })).text, { timeout: 10_000 })
        .toContain('QUE_AFTER_5e17')
      expect(
        data
          .slice(seenBefore)
          .map((d) => d.data)
          .join('')
      ).not.toContain('QUE_AFTER_5e17')
    }, 20_000)
  })

  describe('resize', () => {
    it('applies the size requested on attach and on resize', async () => {
      const { id } = await client.request('term.create', { file: '/bin/cat', cols: 80, rows: 24 })

      const attached = await client.request('term.attach', { id, cols: 90, rows: 20 })
      expect(attached).toMatchObject({ cols: 90, rows: 20 })

      await client.request('term.resize', { id, cols: 100, rows: 30 })
      const listed = await client.request('term.list')
      expect(listed.find((t) => t.id === id)).toMatchObject({ cols: 100, rows: 30, alive: true })
    }, 20_000)
  })

  describe('kill', () => {
    it('kills a terminal, announces it, and drops it from the list', async () => {
      const created = recordEvents(client, 'term.created')
      const killed = recordEvents(client, 'term.killed')
      const { id } = await client.request('term.create', { file: '/bin/cat', cols: 80, rows: 24 })
      await expect.poll(() => created, { timeout: 5_000 }).toContainEqual({ id })

      await client.request('term.kill', { id })

      await expect.poll(() => killed, { timeout: 5_000 }).toContainEqual({ id })
      expect((await client.request('term.list')).map((t) => t.id)).not.toContain(id)
    }, 20_000)
  })
})
