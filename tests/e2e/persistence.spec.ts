// Proves terminals survive quitting and relaunching the app: the daemon owns
// the PTY, and the relaunched app reattaches and replays its screen. And the
// other way round: the daemon restarted under a running app (`que daemon
// restart`), which says it is reconnecting and comes back on the same workspace.
import { expect, test } from '@playwright/test'
import type { TermInfo } from '../../src/shared/protocol'
import type { Workspace } from '../../src/shared/types'
import { makeTempRepo } from '../../src/testing/temp-repo'
import { AppShellPage } from './pages/AppShellPage'
import { SidebarPage } from './pages/SidebarPage'
import { TerminalPage } from './pages/TerminalPage'
import { type LaunchedApp, launchApp, tempDir } from './utils/app'
import { que, queAsync, queJson } from './utils/que'

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
    await expect(new SidebarPage(launched.window).sessionOpen(termId)).toHaveAttribute(
      'aria-current',
      'page'
    )
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

test('the app reconnects after the daemon restarts from the CLI, on the same workspace', async () => {
  const repo = makeTempRepo(tempDir('que-e2e-repo-'))
  const marker = `QUE_RESTARTED_${Math.random().toString(36).slice(2, 10)}`
  let workspace: Workspace
  let termId = ''
  let appShell: AppShellPage
  let sidebar: SidebarPage
  let terminal: TerminalPage

  await test.step('Launch, and open a workspace with a terminal', async () => {
    launched = await launchApp()
    appShell = new AppShellPage(launched.window)
    sidebar = new SidebarPage(launched.window)
    terminal = new TerminalPage(launched.window)
    await appShell.waitForLoad()
    await terminal.waitForActiveTerminal()
    que(launched.queHome, 'project', 'add', repo)
    workspace = queJson<Workspace>(
      launched.queHome,
      'work',
      '--name',
      'APP-1432 retry logic',
      '-r',
      repo,
      '--json'
    )
    termId = que(launched.queHome, 'ws', 'terminal', workspace.id).trim()
    await sidebar.workspaceOpen(workspace.id).click()
    await terminal.tabSelect(termId).click()
    await expect.poll(() => terminal.activeTermId()).toBe(termId)
  })

  await test.step('Restart the daemon from the CLI; the window says it is reconnecting', async () => {
    const restart = queAsync(launched.queHome, 'daemon', 'restart')
    await expect(appShell.reconnecting).toBeVisible()
    const r = await restart
    expect(r.code, r.stderr).toBe(0)
    expect(r.stdout).toContain('ended 2 terminals')
  })

  await test.step('The app recovers on the same workspace with a fresh, live shell', async () => {
    await expect(appShell.reconnecting).toBeHidden({ timeout: 20_000 })
    await expect(appShell.error).toHaveCount(0)
    await expect(sidebar.workspaceOpen(workspace.id)).toHaveAttribute('aria-current', 'page')
    await expect(terminal.tabExited(termId)).toBeVisible()
    await expect.poll(() => terminal.activeTermId(), { timeout: 20_000 }).not.toBe(termId)
    const fresh = await terminal.activeTermId()
    const terms = queJson<TermInfo[]>(launched.queHome, 'term', 'list', '--json')
    expect(terms.find((t) => t.id === fresh)).toMatchObject({
      workspaceId: workspace.id,
      alive: true
    })
    await terminal.input.focus()
    await launched.window.keyboard.type(`echo ${marker}`)
    await launched.window.keyboard.press('Enter')
    await terminal.expectScreenToContain(marker)
    await launched.window.screenshot({ path: 'test-results/persistence-03-after-restart.png' })
  })
})
