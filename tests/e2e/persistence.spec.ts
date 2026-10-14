// Proves terminals survive quitting and relaunching the app: the daemon owns
// the PTY, and the relaunched app reattaches and replays its screen.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TermInfo } from '../../src/shared/protocol'

const root = resolve(__dirname, '../..')
const shots = join(root, 'test-results')
const queHome = mkdtempSync(join(os.tmpdir(), 'que-e2e-'))

function env(): Record<string, string> {
  const e: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v
  delete e.ELECTRON_RUN_AS_NODE
  delete e.ELECTRON_RENDERER_URL
  e.QUE_HOME = queHome
  e.QUE_E2E = '1'
  return e
}

function cli(...args: string[]): string {
  return execFileSync(process.execPath, [join(root, 'out/cli/index.js'), ...args], {
    env: env(),
    encoding: 'utf8'
  })
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ['.'], cwd: root, env: env() })
  current = app
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.__que?.activeTermId()), null, { timeout: 20_000 })
  return { app, page }
}

/** Waits until the shell has drawn something and gone quiet (prompt ready). */
async function waitForPrompt(page: Page): Promise<void> {
  let last = ''
  let stableSince = Date.now()
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => window.__que!.screenText())
    if (text !== last) {
      last = text
      stableSince = Date.now()
    } else if (text.trim().length > 0 && Date.now() - stableSince > 750) {
      return
    }
    await page.waitForTimeout(100)
  }
  throw new Error('shell prompt never settled')
}

/** Waits for a screen line that is exactly `marker`: the command's output, not its echo. */
async function waitForOutputLine(page: Page, marker: string): Promise<void> {
  try {
    await page.waitForFunction(
      (m) => window.__que!.screenText().split('\n').some((l) => l.trim() === m),
      marker,
      { timeout: 15_000 }
    )
  } catch (err) {
    const screen = await page.evaluate(() => window.__que!.screenText()).catch(() => '<unavailable>')
    throw new Error(`no output line "${marker}"; screen was:\n${screen}`, { cause: err })
  }
}

async function typeLine(page: Page, line: string): Promise<void> {
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
}

// The app currently open, if any; closed before the daemon in afterAll so it
// cannot reconnect and respawn a daemon after shutdown.
let current: ElectronApplication | null = null

test.afterAll(async () => {
  await current?.close().catch(() => {})
  // Never leave a daemon behind, even if the test failed midway.
  try {
    cli('daemon', 'stop')
  } catch {
    // Already stopped.
  }
})

test('terminal survives quit and relaunch', async () => {
  mkdirSync(shots, { recursive: true })
  const marker = `QUE_PERSIST_${Math.random().toString(36).slice(2, 10)}`

  // --- first launch: fresh home, so the app creates a terminal ---
  let { app, page } = await launch()
  const termId = await page.evaluate(() => window.__que!.activeTermId())
  expect(termId).toBeTruthy()
  await waitForPrompt(page)
  await typeLine(page, `echo ${marker}`)
  await waitForOutputLine(page, marker)
  await page.screenshot({ path: join(shots, '01-before-quit.png') })
  await app.close()

  // --- app gone; the daemon still has the terminal ---
  const listed = JSON.parse(cli('term', 'list', '--json')) as TermInfo[]
  const t = listed.find((x) => x.id === termId)
  expect(t, `terminal ${termId} missing from ${JSON.stringify(listed)}`).toBeTruthy()
  expect(t!.alive).toBe(true)
  expect(cli('term', 'snapshot', termId!)).toContain(marker)

  // --- relaunch: reattaches to the same terminal and replays the screen ---
  ;({ app, page } = await launch())
  expect(await page.evaluate(() => window.__que!.activeTermId())).toBe(termId)
  await waitForOutputLine(page, marker)
  await expect(page.locator(`[data-term-id="${termId}"] .badge`)).toHaveText('reattached')

  await typeLine(page, 'echo STILL_ALIVE')
  await waitForOutputLine(page, 'STILL_ALIVE')
  await page.screenshot({ path: join(shots, '02-after-relaunch.png') })

  // --- cleanup through the protocol ---
  cli('term', 'kill', termId!)
  await expect(page.locator(`[data-term-id="${termId}"]`)).toHaveCount(0)
  await app.close()
  current = null
  expect(cli('term', 'list')).toContain('no terminals')
  expect(cli('daemon', 'stop')).toContain('daemon stopped')
})
