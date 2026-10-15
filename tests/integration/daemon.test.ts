// Daemon-level methods over the real socket: ping, structured errors, shutdown.
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { DaemonError } from '@shared/client'
import type { MethodName } from '@shared/protocol'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { FAKES_BIN } from '../../src/testing/fakes'

let daemon: TestDaemon
let onShutdown: Mock<() => void>

beforeEach(async () => {
  onShutdown = vi.fn<() => void>()
  daemon = await startTestDaemon({ onShutdown })
})

afterEach(async () => {
  await daemon.close()
})

describe('daemon', () => {
  describe('ping', () => {
    it('answers with its version, pid, and node version', async () => {
      const r = await daemon.client.request('daemon.ping')

      expect(r).toMatchObject({ version: 'test', pid: process.pid, nodeVersion: process.version })
      expect(Number.isNaN(Date.parse(r.startedAt))).toBe(false)
      expect(r.path).toContain(FAKES_BIN)
    })
  })

  describe('errors', () => {
    it('answers not_found for an unknown terminal', async () => {
      await expect(
        daemon.client.request('term.kill', { id: 'term_missing_0c4d' })
      ).rejects.toMatchObject({
        code: 'not_found'
      })
    })

    it('answers unknown_method for a method it does not have', async () => {
      const err = await daemon.client.request('term.bogus' as MethodName).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(DaemonError)
      expect(err).toMatchObject({ code: 'unknown_method' })
    })

    it('answers bad_request for invalid params', async () => {
      await expect(
        daemon.client.request('term.create', { cols: 0, rows: 24, file: '/bin/cat' })
      ).rejects.toMatchObject({ code: 'bad_request' })
    })
  })

  describe('shutdown', () => {
    it('acknowledges daemon.shutdown, then hands over to the shutdown hook', async () => {
      expect(await daemon.client.request('daemon.shutdown')).toEqual({ ok: true })

      await expect.poll(() => onShutdown.mock.calls.length, { timeout: 5_000 }).toBeGreaterThan(0)
    })
  })
})
