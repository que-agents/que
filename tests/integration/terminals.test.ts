// Terminals over the real socket: real node-pty, the headless mirror, and the
// real DaemonClient against an in-process DaemonServer (migrated from the
// first work package's pty-host and server tests).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DaemonClient } from '@shared/client'
import type { Events } from '@shared/protocol'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'

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
function record<E extends keyof Events>(c: DaemonClient, event: E): Events[E][] {
  const seen: Events[E][] = []
  c.on(event, (data) => seen.push(data))
  return seen
}

describe('terminals', () => {
  describe('output', () => {
    it('mirrors program output into the snapshot and reports the exit code', async () => {
      const exits = record(client, 'term.exit')
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
      const data = record(client, 'term.data')
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
      const data = record(client, 'term.data')
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
      const created = record(client, 'term.created')
      const killed = record(client, 'term.killed')
      const { id } = await client.request('term.create', { file: '/bin/cat', cols: 80, rows: 24 })
      await expect.poll(() => created, { timeout: 5_000 }).toContainEqual({ id })

      await client.request('term.kill', { id })

      await expect.poll(() => killed, { timeout: 5_000 }).toContainEqual({ id })
      expect((await client.request('term.list')).map((t) => t.id)).not.toContain(id)
    }, 20_000)
  })
})
