// A tab says what its terminal is running: the login shell's name at rest,
// `cat` while cat holds the foreground, and the shell's name again after Ctrl+C.
import { basename } from 'node:path'
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
  // The daemon starts the login shell `$SHELL` names (zsh when unset); the tab
  // reads its name, not the helper node-pty spawns it through.
  const shell = basename(process.env.SHELL || '/bin/zsh')

  await test.step('Launch on a fresh QUE_HOME; the tab reads the shell', async () => {
    launched = await launchApp()
    await new AppShellPage(launched.window).waitForLoad()
    terminal = new TerminalPage(launched.window)
    id = await terminal.waitForActiveTerminal()
    await expect(terminal.tabSelect(id)).toHaveText(shell)
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
