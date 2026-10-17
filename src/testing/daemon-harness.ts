// The in-process daemon for integration tests (vitest-testing skill, 5a): a
// fresh temp QUE_HOME, the fakes first on PATH, the real DaemonServer on the
// home's socket, and a connected DaemonClient. close() tears it all down and
// runs the leak check. The hooks wrapper's bin/que runs the CLI bundled from
// source, and the user config lives at <home>/config.toml (QUE_CONFIG). Git
// gets a fixed identity from <home>/gitconfig (GIT_CONFIG_GLOBAL), so commits
// made by the finisher or the fake claude never depend on the machine's config.
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { expect, vi } from 'vitest'
import { DaemonServer } from '@daemon/server'
import { DaemonClient } from '@shared/client'
import { ensureDirs, quePaths } from '@shared/paths'
import type { Events } from '@shared/protocol'
import type { Task, TaskState, WorkspaceStatus } from '@shared/types'
import { bundleEntry } from './bundle'
import { fakeEnv, QUIET_OFF, writeGitconfig } from '../../tests/fakes/env.cjs'
import { assertPidsGone, LeakCheckedPtyHost } from './leak-check'

export interface TestDaemon {
  /** The temp QUE_HOME; removed by close(). */
  home: string
  /** The daemon socket inside `home`. */
  socket: string
  host: LeakCheckedPtyHost
  server: DaemonServer
  client: DaemonClient
  /** Where the fakes record their calls (read with readFakeLog / readWrapperLog). */
  claudeLog: string
  ghLog: string
  /** The fake gh's pull requests (QUE_FAKE_GH_PRS), keyed by branch; see setFakePullRequest. */
  ghPrs: string
  /** The fake acli's call log and issue file (QUE_FAKE_ACLI_LOG / QUE_FAKE_ACLI_TICKETS). */
  acliLog: string
  acliTickets: string
  codeLog: string
  caffeinateLog: string
  wrapperLog: string
  /** QUE_CONFIG for this daemon (always written; see withQuietOff). */
  configPath: string
  /**
   * Tears down client, terminals, task runs, server, env, and home; fails on
   * leaked pids. `keepHome` leaves QUE_HOME for a second daemon (restart tests).
   */
  close(opts?: { keepHome?: boolean }): Promise<void>
}

/**
 * Sidebar-title summaries default to on, which would run the fake claude in the
 * background and replace every brief title while a test reads it. Test daemons
 * turn them off unless a test's own config sets `summaries`.
 */
export const SUMMARIES_OFF = 'summaries = false\n'

/**
 * A test config with quiet hours off (QUIET_OFF) unless it sets its own [quiet_hours], and
 * summaries off (SUMMARIES_OFF) unless it sets `summaries` (top-level keys go first, before any table).
 */
export function withQuietOff(config = ''): string {
  const summaries = /^summaries\s*=/m.test(config) ? '' : SUMMARIES_OFF
  const quiet = config.includes('[quiet_hours]') ? config : `${config}\n${QUIET_OFF}`

  return `${summaries}${quiet}`
}

export interface TestDaemonOptions {
  /** Called after daemon.shutdown's response is flushed. */
  onShutdown?: () => void
  /** config.toml contents, written before the daemon starts (quiet hours and summaries off unless set). */
  config?: string
  /** The clock quiet hours and the summary throttle read (e.g. real time shifted ahead). */
  now?: () => number
  /** Quiet-hours re-evaluation interval. Default 200 ms (the daemon's is 15 s). */
  quietTickMs?: number
  /** How long a summary call may run before it is stopped. Default the daemon's (60 s). */
  summaryTimeoutMs?: number
  /** Status engine stall-check interval. Default 200 ms (the daemon's is 5 s). */
  statusTickMs?: number
  /** Reuse this QUE_HOME (from a daemon closed with keepHome) instead of a fresh one. */
  home?: string
  /** Directories put ahead of the fakes on the daemon's PATH (e.g. FAKE_WRAPPERS). */
  pathPrefix?: string[]
  /** Draws the names of workspaces created without one (e.g. scripted, to force clashes). */
  randomWorkspaceName?: () => string
}

export async function startTestDaemon(opts: TestDaemonOptions = {}): Promise<TestDaemon> {
  const home = opts.home ?? fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'que-it-')))
  const env = fakeEnv(home, opts.pathPrefix)
  writeGitconfig(home, 'test')

  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  vi.stubEnv('QUE_NODE', process.execPath)
  const configPath = env.QUE_CONFIG
  fs.writeFileSync(configPath, withQuietOff(opts.config))

  const paths = ensureDirs(quePaths())
  const host = new LeakCheckedPtyHost()

  const server = new DaemonServer({
    host,
    version: 'test',
    onShutdown: opts.onShutdown,
    cliScript: bundleEntry('src/cli/index.ts'),
    statusTickMs: opts.statusTickMs ?? 200,
    queueTickMs: 100,
    quietTickMs: opts.quietTickMs ?? 200,
    now: opts.now,
    summaryTimeoutMs: opts.summaryTimeoutMs,
    randomWorkspaceName: opts.randomWorkspaceName
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
    claudeLog: env.QUE_FAKE_CLAUDE_LOG,
    ghLog: env.QUE_FAKE_GH_LOG,
    ghPrs: env.QUE_FAKE_GH_PRS,
    acliLog: env.QUE_FAKE_ACLI_LOG,
    acliTickets: env.QUE_FAKE_ACLI_TICKETS,
    codeLog: env.QUE_FAKE_CODE_LOG,
    caffeinateLog: env.QUE_FAKE_CAFFEINATE_LOG,
    wrapperLog: env.QUE_FAKE_WRAPPER_LOG,
    configPath,
    async close(closeOpts = {}) {
      if (closed) return
      closed = true
      const taskPids = server.tasks.pids()
      client.close()
      host.killAll()
      await server.close()
      vi.unstubAllEnvs()

      try {
        await assertPidsGone([...host.pids, ...taskPids])
      } finally {
        if (!closeOpts.keepHome) fs.rmSync(home, { recursive: true, force: true })
      }
    }
  }
}

/** Every `event` the client receives from now on, in order. */
export function recordEvents<E extends keyof Events>(client: DaemonClient, event: E): Events[E][] {
  const seen: Events[E][] = []
  client.on(event, (data) => seen.push(data))

  return seen
}

/** Polls workspace.get until the workspace's status is `status`. */
export async function waitForStatus(
  d: TestDaemon,
  wsId: string,
  status: WorkspaceStatus,
  timeoutMs = 10_000
): Promise<void> {
  await expect
    .poll(async () => (await d.client.request('workspace.get', { id: wsId })).status, {
      timeout: timeoutMs
    })
    .toBe(status)
}

/** Polls task.get until the task is in `state`, then returns it. */
export async function waitForTaskState(
  d: TestDaemon,
  id: string,
  state: TaskState,
  timeoutMs = 20_000
): Promise<Task> {
  await expect
    .poll(async () => (await d.client.request('task.get', { id })).state, { timeout: timeoutMs })
    .toBe(state)

  return d.client.request('task.get', { id })
}
