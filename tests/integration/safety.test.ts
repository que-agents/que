// What que guarantees about the machine it runs on: an owner-only socket,
// nothing written outside QUE_HOME, and no processes left behind.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DaemonClient } from '@shared/client'
import { quePaths } from '@shared/paths'
import { bundleEntry } from '../../src/testing/bundle'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'
import { FAKES_BIN } from '../../src/testing/fakes'
import { runCliWith } from '../../src/testing/cli'
import { assertPidsGone, pidAlive } from '../../src/testing/leak-check'

// Captured before any test stubs HOME. Only ever read, never written.
const REAL_QUE_HOME = join(os.homedir(), '.que')

function statOrNull(path: string): { mtimeMs: number } | null {
  try {
    return { mtimeMs: fs.statSync(path).mtimeMs }
  } catch {
    return null
  }
}

/** Every path under `dir`, relative to it. */
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()
}

describe('safety', () => {
  describe('in-process daemon', () => {
    let daemon: TestDaemon

    beforeEach(async () => {
      daemon = await startTestDaemon()
    })

    afterEach(async () => {
      await daemon.close()
    })

    it('creates the socket owner-only (0600)', () => {
      expect(fs.statSync(daemon.socket).mode & 0o777).toBe(0o600)
    })

    it('leaves no terminal process alive after killAll()', async () => {
      for (const name of ['uploader', 'api', 'docs']) {
        await daemon.client.request('term.create', {
          file: '/bin/sh',
          args: ['-c', 'sleep 30'],
          name,
          cols: 80,
          rows: 24
        })
      }
      const pids = (await daemon.client.request('term.list')).map((t) => t.pid)
      expect(pids).toHaveLength(3)
      expect(pids.every(pidAlive)).toBe(true)

      daemon.host.killAll()

      await expect.poll(() => pids.filter(pidAlive), { timeout: 5_000 }).toEqual([])
    }, 20_000)
  })

  describe('daemon process', () => {
    let fakeHome: string
    let queHome: string
    let realQueBefore: { mtimeMs: number } | null
    let client: DaemonClient | null
    let daemonPid: number | null

    beforeEach(async () => {
      realQueBefore = statOrNull(REAL_QUE_HOME)
      fakeHome = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'que-safety-home-')))
      queHome = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'que-safety-qh-')))
      vi.stubEnv('HOME', fakeHome)
      vi.stubEnv('QUE_HOME', queHome)
      vi.stubEnv('PATH', `${FAKES_BIN}:${process.env.PATH}`)

      client = await DaemonClient.connectOrStart({
        paths: quePaths(),
        runtime: process.execPath,
        daemonScript: bundleEntry('src/daemon/index.ts'),
        timeoutMs: 10_000
      })
      daemonPid = (await client.request('daemon.ping')).pid
    }, 20_000)

    afterEach(async () => {
      client?.close()
      // Stop a daemon a failed test left running, by its own pid only.
      if (daemonPid !== null && pidAlive(daemonPid)) process.kill(daemonPid, 'SIGTERM')
      if (daemonPid !== null) await assertPidsGone([daemonPid], 5_000)
      vi.unstubAllEnvs()
      fs.rmSync(fakeHome, { recursive: true, force: true })
      fs.rmSync(queHome, { recursive: true, force: true })
    }, 20_000)

    it('runs as its own process and records its pid in QUE_HOME', () => {
      expect(daemonPid).not.toBe(process.pid)
      expect(fs.readFileSync(join(queHome, 'daemon.pid'), 'utf8').trim()).toBe(String(daemonPid))
    })

    it('writes nothing outside QUE_HOME', async () => {
      const c = client as DaemonClient
      const { id } = await c.request('term.create', {
        file: '/bin/sh',
        args: ['-c', 'printf QUE_SAFETY_2d9c; sleep 30'],
        cwd: queHome,
        cols: 80,
        rows: 24
      })
      await expect
        .poll(async () => (await c.request('term.snapshot', { id })).text, { timeout: 10_000 })
        .toContain('QUE_SAFETY_2d9c')

      await c.request('daemon.shutdown')
      await expect.poll(() => pidAlive(daemonPid as number), { timeout: 10_000 }).toBe(false)

      expect(walk(fakeHome)).toEqual([])
      expect(statOrNull(REAL_QUE_HOME)).toEqual(realQueBefore)
      expect(walk(queHome)).toEqual([
        'bin',
        join('bin', 'claude'),
        join('bin', 'que'),
        'hooks.json',
        'logs',
        join('logs', 'daemon.log'),
        'que.db',
        'shell',
        join('shell', 'zsh'),
        join('shell', 'zsh', '.zlogin'),
        join('shell', 'zsh', '.zprofile'),
        join('shell', 'zsh', '.zshenv'),
        join('shell', 'zsh', '.zshrc'),
        'system.md'
      ])
      expect(fs.statSync(join(queHome, 'bin', 'claude')).mode & 0o777).toBe(0o755)
      expect(fs.statSync(join(queHome, 'bin', 'que')).mode & 0o777).toBe(0o755)
    }, 30_000)

    it('is gone after daemon.shutdown, and so are its terminals', async () => {
      const c = client as DaemonClient
      await c.request('term.create', {
        file: '/bin/sh',
        args: ['-c', 'sleep 30'],
        cols: 80,
        rows: 24
      })
      const termPids = (await c.request('term.list')).map((t) => t.pid)
      const pid = Number(fs.readFileSync(join(queHome, 'daemon.pid'), 'utf8').trim())
      expect(pidAlive(pid)).toBe(true)

      expect(await c.request('daemon.shutdown')).toEqual({ ok: true })

      await expect.poll(() => pidAlive(pid), { timeout: 10_000 }).toBe(false)
      await assertPidsGone(termPids)
      expect(fs.existsSync(join(queHome, 'daemon.pid'))).toBe(false)
      expect(fs.existsSync(join(queHome, 'daemon.sock'))).toBe(false)
    }, 30_000)
  })
})

describe('safety: hooks wrapper', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'que-safety-hook-')))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const hookJson = JSON.stringify({
    hook_event_name: 'PermissionRequest',
    session_id: '7d0c5b2a-0000-4000-8000-3e4f5a6b7c8d',
    cwd: '/Users/dev/.que/worktrees/uploader/ha-1432-retry-logic',
    tool_name: 'Bash'
  })

  it('`que hook` exits 0 silently when no daemon is listening', async () => {
    const r = await runCliWith(
      {
        input: hookJson,
        env: {
          QUE_HOME: dir,
          QUE_WORKSPACE_ID: 'ws_a2b3c4d5e6f7',
          QUE_SOCKET: join(dir, 'none.sock')
        }
      },
      'hook'
    )

    expect(r).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(fs.readdirSync(dir)).toEqual([])
  }, 20_000)

  it('`que hook` gives up within its budget when the daemon never answers', async () => {
    const socket = join(dir, 'mute.sock')
    // Reads requests and never answers.
    const mute = net.createServer((conn) => conn.resume())
    await new Promise<void>((r) => mute.listen(socket, r))
    const started = Date.now()

    const r = await runCliWith(
      {
        input: hookJson,
        env: { QUE_HOME: dir, QUE_WORKSPACE_ID: 'ws_a2b3c4d5e6f7', QUE_SOCKET: socket }
      },
      'hook'
    )

    const elapsed = Date.now() - started
    await new Promise<void>((r) => mute.close(() => r()))
    expect(r).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(elapsed).toBeLessThan(5_000)
  }, 20_000)

  it('the claude wrapper refuses (127) rather than run itself when no real claude is on PATH', async () => {
    const daemon = await startTestDaemon()
    try {
      const wrapper = join(daemon.home, 'bin', 'claude')
      const r = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        execFile(
          wrapper,
          ['--version'],
          {
            env: {
              PATH: `${join(daemon.home, 'bin')}:/usr/bin:/bin`,
              QUE_WORKSPACE_ID: 'ws_a2b3c4d5e6f7'
            }
          },
          (err, _stdout, stderr) =>
            resolve({ code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stderr })
        )
      })

      expect(r.code).toBe(127)
      expect(r.stderr).toContain('que: could not find the claude executable')
    } finally {
      await daemon.close()
    }
  }, 20_000)
})
