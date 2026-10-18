// The daemon's build id against the bundle the CLI would start, and
// `que daemon restart`, with the daemon as its own process (the bundled daemon).
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildIdOf } from '@shared/build-id'
import { DaemonClient } from '@shared/client'
import { quePaths } from '@shared/paths'
import { pidAlive } from '../../src/shared/process'
import { bundleEntry } from '../../src/testing/bundle'
import { runCli, runCliJson } from '../../src/testing/cli'
import { FAKES_BIN } from '../../src/testing/fakes'
import { assertPidsGone } from '../../src/testing/leak-check'

let fakeHome: string
let queHome: string
let daemonScript: string
let client: DaemonClient | null

/** Every daemon pid this file started (through the client or the CLI), stopped by pid afterwards. */
let daemonPids: number[]

beforeEach(async () => {
  fakeHome = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'que-build-home-')))
  queHome = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'que-build-qh-')))
  // Never the user's config, and quiet hours off so the suite runs at any hour.
  fs.writeFileSync(join(queHome, 'config.toml'), '[quiet_hours]\nenabled = false\n')
  vi.stubEnv('QUE_CONFIG', join(queHome, 'config.toml'))
  vi.stubEnv('HOME', fakeHome)
  vi.stubEnv('QUE_HOME', queHome)
  vi.stubEnv('PATH', `${FAKES_BIN}:${process.env.PATH}`)

  // The bundle the test CLI would start, built beside it as out/ lays them out.
  daemonScript = bundleEntry('src/daemon/index.ts')
  client = await DaemonClient.connectOrStart({
    paths: quePaths(),
    runtime: process.execPath,
    daemonScript,
    timeoutMs: 10_000
  })
  daemonPids = [(await client.request('daemon.ping')).pid]
}, 20_000)

afterEach(async () => {
  client?.close()

  for (const pid of daemonPids) if (pidAlive(pid)) process.kill(pid, 'SIGTERM')
  await assertPidsGone(daemonPids, 5_000)
  vi.unstubAllEnvs()
  fs.rmSync(fakeHome, { recursive: true, force: true })
  fs.rmSync(queHome, { recursive: true, force: true })
}, 20_000)

describe('daemon build id', () => {
  it('answers ping with the build id of its own bundle', async () => {
    const ping = await (client as DaemonClient).request('daemon.ping')

    expect(ping.buildId).toMatch(/^[0-9a-f]{12}$/)
    expect(ping.buildId).toBe(buildIdOf(daemonScript))
  })

  it('reports both ids in `que daemon status`, not stale when they match', async () => {
    const id = buildIdOf(daemonScript)

    const status = await runCliJson<Record<string, unknown>>('daemon', 'status', '--json')
    const text = await runCli('daemon', 'status')

    expect(status).toMatchObject({ running: true, buildId: id, expectedBuildId: id, stale: false })
    expect(text.stdout).toContain(`build ${id}`)
    expect(text.stdout).not.toContain('que daemon restart')
  }, 30_000)

  it('checks the daemon build in `que doctor`', async () => {
    const r = await runCli('doctor')

    expect(r.stdout).toMatch(
      new RegExp(`ok\\s+daemon build\\s+${buildIdOf(daemonScript)} \\(matches this que\\)`)
    )
  }, 30_000)
})

describe('que daemon restart', () => {
  it('ends the terminals, and a new daemon from this build answers', async () => {
    const c = client as DaemonClient
    const old = await c.request('daemon.ping')
    await c.request('term.create', {
      file: '/bin/sh',
      args: ['-c', 'sleep 30'],
      cwd: queHome,
      cols: 80,
      rows: 24
    })
    const termPids = (await c.request('term.list')).map((t) => t.pid)
    c.close()
    client = null

    const r = await runCli('daemon', 'restart')

    expect(r.code, r.stderr).toBe(0)
    expect(r.stdout).toContain(`daemon stopped (pid ${old.pid}), ended 1 terminal`)
    const next = await DaemonClient.tryConnect(quePaths())
    expect(next).not.toBeNull()
    client = next
    const ping = await (next as DaemonClient).request('daemon.ping')
    daemonPids.push(ping.pid)
    expect(ping.pid).not.toBe(old.pid)
    expect(pidAlive(old.pid)).toBe(false)
    expect(ping.buildId).toBe(buildIdOf(daemonScript))
    expect(r.stdout).toContain(`daemon running pid=${ping.pid}`)
    expect(r.stdout).toContain(`build=${ping.buildId}`)
    expect(await (next as DaemonClient).request('term.list')).toEqual([])
    await assertPidsGone(termPids)
  }, 40_000)
})
