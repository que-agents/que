// A tab says what its terminal is running: it reads `cat` while cat holds the
// foreground of the shell, and the shell's own name again after Ctrl+C.
import { expect, test } from '@playwright/test'
import { AppShellPage } from './pages/AppShellPage'
import { TerminalPage } from './pages/TerminalPage'
import { type LaunchedApp, launchApp } from './utils/app'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close() // quits the app AND stops the test daemon
})

test('a tab reads the program in its terminal, and the shell again once it ends', async () => {
  let terminal: TerminalPage
  let id = ''
  let shell = ''

  await test.step('Launch on a fresh QUE_HOME; the tab reads the shell', async () => {
    launched = await launchApp()
    await new AppShellPage(launched.window).waitForLoad()
    terminal = new TerminalPage(launched.window)
    id = await terminal.waitForActiveTerminal()
    await expect(terminal.tabSelect(id)).not.toHaveText('')
    shell = (await terminal.tabSelect(id).textContent()) ?? ''
    expect(shell).not.toBe('cat')
  })

  await test.step('cat in the foreground names the tab', async () => {
    await terminal.input.focus()
    await launched.window.keyboard.type('cat')
    await launched.window.keyboard.press('Enter')
    await expect.poll(() => terminal.tabSelect(id).textContent()).toBe('cat')
  })

  await test.step('Ctrl+C returns the tab to the shell', async () => {
    await launched.window.keyboard.press('Control+c')
    await expect.poll(() => terminal.tabSelect(id).textContent()).toBe(shell)
  })
})
