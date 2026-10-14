// Proves terminals survive quitting and relaunching the app: the daemon owns
// the PTY, and the relaunched app reattaches and replays its screen.
import { expect, test } from '@playwright/test'
import type { TermInfo } from '../../src/shared/protocol'
import { AppShellPage } from './pages/AppShellPage'
import { TerminalPage } from './pages/TerminalPage'
import { type LaunchedApp, launchApp } from './utils/app'
import { que, queJson } from './utils/que'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close() // quits the app AND stops the test daemon
})

test('a terminal survives quitting the app and is reattached on relaunch', async () => {
  const suffix = Math.random().toString(36).slice(2, 10)
  const marker = `QUE_PERSIST_${suffix}`
  const stillAlive = `QUE_STILL_ALIVE_${suffix}`
  let termId = ''
  let terminal: TerminalPage

  await test.step('Launch on a fresh QUE_HOME; the app opens a terminal', async () => {
    launched = await launchApp()
    await new AppShellPage(launched.window).waitForLoad()
    terminal = new TerminalPage(launched.window)
    termId = await terminal.waitForActiveTerminal()
    await expect(terminal.tab(termId)).toBeVisible()
  })

  await test.step('Run a command in the terminal', async () => {
    await terminal.input.focus()
    await launched.window.keyboard.type(`echo ${marker}`)
    await launched.window.keyboard.press('Enter')
    await terminal.expectScreenToContain(marker)
    await launched.window.screenshot({ path: 'test-results/persistence-01-before-quit.png' })
  })

  await test.step('Quit the app; the daemon keeps the terminal', async () => {
    await launched.app.close() // the app only, NOT launched.close(), which also stops the daemon
    const terms = queJson<TermInfo[]>(launched.queHome, 'term', 'list', '--json')
    expect(terms.find((t) => t.id === termId)?.alive).toBe(true)
    expect(que(launched.queHome, 'term', 'snapshot', termId)).toContain(marker)
  })

  await test.step('Relaunch on the same home; the terminal reattaches and replays', async () => {
    launched = await launchApp({ queHome: launched.queHome })
    await new AppShellPage(launched.window).waitForLoad()
    terminal = new TerminalPage(launched.window)
    expect(await terminal.waitForActiveTerminal()).toBe(termId)
    await terminal.expectScreenToContain(marker)
    await expect(terminal.tabReattached(termId)).toBeVisible()
  })

  await test.step('The reattached shell still runs commands', async () => {
    await terminal.input.focus()
    await launched.window.keyboard.type(`echo ${stillAlive}`)
    await launched.window.keyboard.press('Enter')
    await terminal.expectScreenToContain(stillAlive)
    await launched.window.screenshot({ path: 'test-results/persistence-02-after-relaunch.png' })
  })

  await test.step('Killing the terminal through the CLI removes its tab', async () => {
    que(launched.queHome, 'term', 'kill', termId)
    await expect(terminal.tab(termId)).toHaveCount(0)
    await expect(terminal.emptyState).toBeVisible()
    expect(que(launched.queHome, 'term', 'list')).toContain('no terminals')
  })
})
