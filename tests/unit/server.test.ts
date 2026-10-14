import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DaemonClient, DaemonError } from '../../src/shared/client'
import { PtyHost } from '../../src/daemon/pty-host'
import { DaemonServer } from '../../src/daemon/server'

const dir = fs.mkdtempSync(join(os.tmpdir(), 'que-test-'))
const sock = join(dir, 's.sock')
const host = new PtyHost()
let shutdownCalled = false
const server = new DaemonServer({ host, version: 'test', onShutdown: () => (shutdownCalled = true) })
const client = new DaemonClient(sock)

beforeAll(async () => {
  await server.listen(sock)
  await client.connect()
})

afterAll(async () => {
  client.close()
  host.killAll()
  await server.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

async function waitFor(cond: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('DaemonServer', () => {
  it('creates the socket owner-only', () => {
    expect(fs.statSync(sock).mode & 0o777).toBe(0o600)
  })

  it('answers ping', async () => {
    const r = await client.request('daemon.ping')
    expect(r).toMatchObject({ version: 'test', pid: process.pid })
    expect(r.nodeVersion).toBe(process.version)
  })

  it('returns structured errors', async () => {
    await expect(client.request('term.kill', { id: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
    const err = await (client.request as (m: string) => Promise<unknown>)('bogus').catch((e) => e)
    expect(err).toBeInstanceOf(DaemonError)
    expect((err as DaemonError).code).toBe('unknown_method')
  })

  it('creates, attaches, streams, and kills a terminal', async () => {
    const created: string[] = []
    const killed: string[] = []
    let data = ''
    client.on('term.created', (e) => created.push(e.id))
    client.on('term.killed', (e) => killed.push(e.id))
    client.on('term.data', (e) => (data += e.data))

    const { id } = await client.request('term.create', { file: '/bin/cat', cols: 80, rows: 24 })
    await waitFor(() => created.includes(id))
    const list = await client.request('term.list')
    expect(list.find((t) => t.id === id)).toMatchObject({ alive: true, cols: 80, rows: 24 })

    const att = await client.request('term.attach', { id, cols: 90, rows: 20 })
    expect(att).toMatchObject({ cols: 90, rows: 20 })
    await client.request('term.write', { id, data: 'ping-from-test\n' })
    await waitFor(() => data.includes('ping-from-test'))

    const snap = await client.request('term.snapshot', { id })
    expect(snap.text).toContain('ping-from-test')

    // After detach, no more data events reach this connection.
    await client.request('term.detach', { id })
    const before = data
    await client.request('term.write', { id, data: 'after-detach\n' })
    await waitFor(async () => (await client.request('term.snapshot', { id })).text.includes('after-detach'))
    expect(data).toBe(before)

    // A second connection sees the earlier output in its attach snapshot.
    const other = new DaemonClient(sock)
    await other.connect()
    const att2 = await other.request('term.attach', { id, cols: 90, rows: 20 })
    expect(att2.snapshot).toContain('after-detach')
    other.close()

    await client.request('term.kill', { id })
    await waitFor(() => killed.includes(id))
    expect((await client.request('term.list')).some((t) => t.id === id)).toBe(false)
  })

  it('broadcasts term.exit and invokes shutdown hook', async () => {
    const exits: number[] = []
    client.on('term.exit', (e) => exits.push(e.exitCode))
    await client.request('term.create', { file: '/bin/sh', args: ['-c', 'exit 3'], cols: 80, rows: 24 })
    await waitFor(() => exits.includes(3))

    expect(await client.request('daemon.shutdown')).toEqual({ ok: true })
    await waitFor(() => shutdownCalled)
  })
})
