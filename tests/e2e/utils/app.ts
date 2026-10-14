// Launches the built app for one test: a fresh QUE_HOME (so a fresh daemon),
// QUE_E2E=1 (the renderer's window.__que hook), and the fakes first on PATH.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page
} from '@playwright/test'
import { que } from './que'

export const ROOT = resolve(__dirname, '../../..')
export const FAKES_BIN = join(ROOT, 'tests/fakes/bin')

export interface LaunchedApp {
  app: ElectronApplication
  window: Page
  queHome: string
  /** argv of every fake `gh` call, in order. */
  ghCalls(): string[][]
  /** Quits the app, stops the test daemon, and checks its process is gone. */
  close(): Promise<void>
}

/** The env every process in a test shares: app, daemon, CLI, fakes. */
export function testEnv(
  queHome: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  return {
    ...env,
    QUE_HOME: queHome,
    QUE_E2E: '1',
    PATH: `${FAKES_BIN}:${env.PATH}`,
    QUE_FAKE_GH_LOG: join(queHome, 'fake-gh.log'),
    QUE_FAKE_CODE_LOG: join(queHome, 'fake-code.log'),
    QUE_FAKE_CLAUDE_TRANSCRIPT_DIR: join(queHome, 'fake-claude-transcripts'),
    ...extra
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function launchApp(
  opts: { queHome?: string; env?: Record<string, string> } = {}
): Promise<LaunchedApp> {
  const queHome = opts.queHome ?? mkdtempSync(join(os.tmpdir(), 'que-e2e-'))
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env: testEnv(queHome, opts.env) })
  const window = await app.firstWindow()
  return {
    app,
    window,
    queHome,
    ghCalls: () => {
      const log = join(queHome, 'fake-gh.log')
      if (!existsSync(log)) return []
      return readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((l) => (JSON.parse(l) as { argv: string[] }).argv)
    },
    close: async () => {
      // The app first, so it cannot reconnect and respawn a daemon.
      await app.close().catch(() => {})
      const pidFile = join(queHome, 'daemon.pid')
      const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').trim()) : null
      try {
        que(queHome, 'daemon', 'stop')
      } catch {
        // Already stopped.
      }
      if (pid !== null) {
        await expect
          .poll(() => pidAlive(pid), { message: `daemon pid ${pid} still alive`, timeout: 10_000 })
          .toBe(false)
      }
    }
  }
}
