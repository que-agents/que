// The in-process daemon for integration tests (vitest-testing skill, 5a): a
// fresh temp QUE_HOME, the fakes first on PATH, the real DaemonServer on the
// home's socket, and a connected DaemonClient. close() tears it all down and
// runs the leak check. The hooks wrapper's bin/que runs the CLI bundled from
// source, and the user config lives at <home>/config.toml (QUE_CONFIG).
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { DaemonServer } from '@daemon/server'
import { DaemonClient } from '@shared/client'
import { ensureDirs, quePaths } from '@shared/paths'
import { bundleEntry } from './bundle'
import { FAKES_BIN } from './fakes'
import { assertPidsGone, LeakCheckedPtyHost } from './leak-check'

export interface TestDaemon {
  /** The temp QUE_HOME; removed by close(). */
  home: string
  /** The daemon socket inside `home`. */
  socket: string
  host: LeakCheckedPtyHost
  server: DaemonServer
  client: DaemonClient
  /** Where the fake gh/code record their calls (read with readFakeLog). */
  ghLog: string
  codeLog: string
  /** QUE_CONFIG for this daemon (written only when `config` was passed). */
  configPath: string
  /** Tears down client, terminals, server, env, and home; fails on leaked pids. */
  close(): Promise<void>
}

export interface TestDaemonOptions {
  /** Called after daemon.shutdown's response is flushed. */
  onShutdown?: () => void
  /** config.toml contents, written before the daemon starts. */
  config?: string
  /** Status engine stall-check interval. Default 200 ms (the daemon's is 5 s). */
  statusTickMs?: number
}

export async function startTestDaemon(opts: TestDaemonOptions = {}): Promise<TestDaemon> {
  const home = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'que-it-')))
  const ghLog = join(home, 'fake-gh.log')
  const codeLog = join(home, 'fake-code.log')
  vi.stubEnv('QUE_HOME', home)
  vi.stubEnv('PATH', `${FAKES_BIN}:${process.env.PATH}`)
  vi.stubEnv('QUE_FAKE_GH_LOG', ghLog)
  vi.stubEnv('QUE_FAKE_CODE_LOG', codeLog)
  vi.stubEnv('QUE_FAKE_CLAUDE_TRANSCRIPT_DIR', join(home, 'transcripts'))
  const configPath = join(home, 'config.toml')
  vi.stubEnv('QUE_CONFIG', configPath)
  vi.stubEnv('QUE_NODE', process.execPath)
  if (opts.config !== undefined) fs.writeFileSync(configPath, opts.config)

  const paths = ensureDirs(quePaths())
  const host = new LeakCheckedPtyHost()
  const server = new DaemonServer({
    host,
    version: 'test',
    onShutdown: opts.onShutdown,
    cliScript: bundleEntry('src/cli/index.ts'),
    statusTickMs: opts.statusTickMs ?? 200
  })
  await server.listen(paths.socket)
  const client = new DaemonClient(paths.socket)
  await client.connect()

  let closed = false
  return {
    home,
    socket: paths.socket,
    host,
    server,
    client,
    ghLog,
    codeLog,
    configPath,
    async close() {
      if (closed) return
      closed = true
      client.close()
      host.killAll()
      await server.close()
      vi.unstubAllEnvs()
      try {
        await assertPidsGone(host.pids)
      } finally {
        fs.rmSync(home, { recursive: true, force: true })
      }
    }
  }
}
