// `que daemon upgrade` against a real daemon process: its terminals move to a
// new daemon process with the same ids and the same shells, and a successor
// that cannot start leaves the running daemon serving them.
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DaemonClient } from '@shared/client'
import { quePaths } from '@shared/paths'
import { pidAlive } from '@shared/process'
import type { Events, TermInfo } from '@shared/protocol'
import { bundleEntry } from '../../src/testing/bundle'
import { runCli } from '../../src/testing/cli'
import { assertPidsGone } from '../../src/testing/leak-check'
import { fakeEnv, QUIET_OFF, writeGitconfig } from '../fakes/env.cjs'

const UPGRADE_LINE = /^daemon upgraded: pid (\d+) → (\d+), (\d+) terminals? carried over$/m

let home: string
let scratch: string

/** Every daemon and shell pid a test saw, all of which must be gone at the end. */
let pids: Set<number>
let clients: DaemonClient[]

async function connect(): Promise<DaemonClient> {
  const c = new DaemonClient(quePaths().socket)
  await c.connect()
  clients.push(c)

  return c
}

async function shell(c: DaemonClient): Promise<TermInfo> {
  const t = await c.request('term.create', { file: '/bin/sh', cwd: home, cols: 80, rows: 24 })
  pids.add(t.pid)

  return t
}

async function screen(c: DaemonClient, id: string): Promise<string> {
  return (await c.request('term.snapshot', { id })).text
}

function upgrade(script = bundleEntry('src/daemon/index.ts')): ReturnType<typeof runCli> {
  return runCli('daemon', 'upgrade', '--script', script, '--runtime', process.execPath)
}

beforeEach(async () => {
  // Short enough for the socket to stay inside the home.
  home = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'que-ho-')))
  scratch = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'que-ho-bin-')))
  pids = new Set()
  clients = []
  const env = fakeEnv(home)

  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  writeGitconfig(home, 'handoff')
  fs.writeFileSync(env.QUE_CONFIG, `summaries = false\n${QUIET_OFF}`)

  const c = await DaemonClient.connectOrStart({
    paths: quePaths(),
    runtime: process.execPath,
    daemonScript: bundleEntry('src/daemon/index.ts'),
    timeoutMs: 10_000
  })

  clients.push(c)
  pids.add((await c.request('daemon.ping')).pid)
}, 20_000)

afterEach(async () => {
  for (const c of clients) c.close()
  await runCli('daemon', 'stop')

  try {
    await assertPidsGone(pids, 5_000)
  } finally {
    vi.unstubAllEnvs()
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}, 20_000)

describe('daemon handoff', () => {
  describe('upgrade', () => {
    it('moves a running shell to a new daemon with its id, pid and screen', async () => {
      const before = clients[0]
      const oldPid = (await before.request('daemon.ping')).pid
      const term = await shell(before)
      await before.request('term.write', { id: term.id, data: 'echo BEFORE-$((6*7))\r' })
      await expect.poll(() => screen(before, term.id), { timeout: 5_000 }).toContain('BEFORE-42')

      const r = await upgrade()

      expect(r.code, r.stderr).toBe(0)
      const [, from, to, carried] = UPGRADE_LINE.exec(r.stdout) ?? []

      expect([Number(from), carried]).toEqual([oldPid, '1'])
      const newPid = Number(to)
      pids.add(newPid)

      expect(newPid).not.toBe(oldPid)
      await expect.poll(() => pidAlive(oldPid), { timeout: 5_000 }).toBe(false)

      const after = await connect()

      expect((await after.request('daemon.ping')).pid).toBe(newPid)
      expect(await after.request('term.list')).toEqual([
        expect.objectContaining({ id: term.id, pid: term.pid, alive: true })
      ])

      // Attach replays the screen rebuilt from the old daemon's mirror.
      const attached = await after.request('term.attach', { id: term.id, cols: 100, rows: 40 })

      expect(attached.snapshot).toContain('BEFORE-42')

      const data: string[] = []
      after.on('term.data', (d) => data.push(d.data))
      await after.request('term.write', { id: term.id, data: 'echo AFTER-$((5*5)); stty size\r' })
      await expect.poll(() => data.join(''), { timeout: 5_000 }).toContain('AFTER-25')
      // The attach's size reached the shell through the adopted fd.
      await expect.poll(() => data.join(''), { timeout: 5_000 }).toContain('40 100')
      expect(await screen(after, term.id)).toContain('BEFORE-42')

      const exits: Events['term.exit'][] = []
      after.on('term.exit', (e) => exits.push(e))
      await after.request('term.write', { id: term.id, data: 'exit\r' })

      await expect.poll(() => exits.map((e) => e.id), { timeout: 5_000 }).toEqual([term.id])
      await expect.poll(() => pidAlive(term.pid), { timeout: 5_000 }).toBe(false)
      expect(await after.request('term.list')).toEqual([
        expect.objectContaining({ id: term.id, alive: false })
      ])
    })

    it('carries terminals over twice, and stop afterwards ends every one of them', async () => {
      const first = await shell(clients[0])

      expect((await upgrade()).code).toBe(0)
      const middle = await connect()
      const second = await shell(middle)
      const r = await upgrade()

      expect(r.code, r.stderr).toBe(0)
      const [, , to, carried] = UPGRADE_LINE.exec(r.stdout) ?? []
      pids.add(Number(to))

      expect(carried).toBe('2')
      const last = await connect()
      const ids = (await last.request('term.list')).map((t) => [t.id, t.pid, t.alive])

      expect(ids.sort()).toEqual(
        [
          [first.id, first.pid, true],
          [second.id, second.pid, true]
        ].sort()
      )
      await last.request('term.write', { id: first.id, data: 'echo FIRST-$((2*9))\r' })
      await expect.poll(() => screen(last, first.id), { timeout: 5_000 }).toContain('FIRST-18')
      // afterEach stops the daemon and fails if a shell or daemon is left.
    })
  })

  describe('errors', () => {
    it('keeps the old daemon serving its terminals when the new one fails to start', async () => {
      const c = clients[0]
      const oldPid = (await c.request('daemon.ping')).pid
      const term = await shell(c)
      const broken = join(scratch, 'broken-daemon.js')
      fs.writeFileSync(broken, 'process.exit(3)\n')

      const r = await upgrade(broken)

      expect(r.code).toBe(1)
      expect(r.stderr).toContain('the handoff failed: the new daemon exited (code 3)')
      expect(r.stderr).toContain('que daemon restart')
      expect((await c.request('daemon.ping')).pid).toBe(oldPid)
      expect(await c.request('term.list')).toEqual([
        expect.objectContaining({ id: term.id, pid: term.pid, alive: true })
      ])
      // Reading resumed: what is typed now still comes back.
      await c.request('term.write', { id: term.id, data: 'echo STILL-$((8*8))\r' })
      await expect.poll(() => screen(c, term.id), { timeout: 5_000 }).toContain('STILL-64')
    })

    it('refuses a daemon bundle that does not exist', async () => {
      const r = await upgrade(join(scratch, 'missing', 'index.js'))

      expect(r.code).toBe(1)
      expect(r.stderr).toContain(`no daemon bundle at ${join(scratch, 'missing', 'index.js')}`)
    })
  })
})
