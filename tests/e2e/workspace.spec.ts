// The workspace journey end to end: the CLI creates a project and a workspace
// in the launched app's daemon, the workspace terminal shows up as a tab, and
// a Claude Code session typed into it (the fake, through que's hooks wrapper)
// reports needs input back to `que status`.
import { expect, test } from '@playwright/test'
import type { StatusJson } from '../../src/cli/workspaces'
import type { Project, Workspace } from '../../src/shared/types'
import { AppShellPage } from './pages/AppShellPage'
import { SidebarPage } from './pages/SidebarPage'
import { TerminalPage } from './pages/TerminalPage'
import { type LaunchedApp, launchApp } from './utils/app'
import { que, queJson } from './utils/que'
import { makeRepo } from './utils/repo'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close() // quits the app AND stops the test daemon
})

test('a claude session in a workspace terminal reports needs input to que status', async () => {
  const repo = makeRepo()
  let workspace: Workspace
  let termId = ''
  let terminal: TerminalPage
  let sidebar: SidebarPage
  const statusOf = () =>
    queJson<StatusJson>(launched.queHome, 'status', '--json').workspaces.find(
      (w) => w.id === workspace.id
    )

  await test.step('Launch the app on a fresh QUE_HOME', async () => {
    launched = await launchApp()
    await new AppShellPage(launched.window).waitForLoad()
    terminal = new TerminalPage(launched.window)
    sidebar = new SidebarPage(launched.window)
    await terminal.waitForActiveTerminal()
  })

  await test.step('Add the project and create a workspace with the CLI', async () => {
    const project = queJson<Project>(launched.queHome, 'project', 'add', repo, '--json')
    expect(project).toMatchObject({
      path: expect.stringContaining('que-e2e-repo-'),
      defaultBranch: 'main'
    })
    workspace = queJson<Workspace>(
      launched.queHome,
      'work',
      'APP-1432 retry logic',
      '-r',
      repo,
      '--json'
    )
    expect(workspace).toMatchObject({
      projectId: project.id,
      name: 'app-1432-retry-logic',
      branch: 'app-1432-retry-logic',
      status: 'idle'
    })
  })

  await test.step("Open the workspace's terminal; it appears as a tab under the workspace", async () => {
    termId = que(launched.queHome, 'ws', 'terminal', workspace.id).trim()
    await expect(sidebar.workspace(workspace.id)).toBeVisible()
    await sidebar.workspaceOpen(workspace.id).click()
    await expect(terminal.tab(termId)).toBeVisible()
    await terminal.tabSelect(termId).click()
    await expect.poll(() => terminal.activeTermId()).toBe(termId)
  })

  await test.step('Start claude in it; the session reports in', async () => {
    await terminal.input.focus()
    await launched.window.keyboard.type('claude')
    await launched.window.keyboard.press('Enter')
    await expect
      .poll(() => statusOf()?.sessionId ?? null, {
        message: 'no session reported',
        timeout: 30_000
      })
      .toMatch(/^[0-9a-f-]{36}$/)
  })

  await test.step('Ask for something that needs permission; que status says needs input', async () => {
    await launched.window.keyboard.type('/needs-input')
    await launched.window.keyboard.press('Enter')
    await expect.poll(() => statusOf()?.status, { timeout: 30_000 }).toBe('needs_input')
    await sidebar.waitForWorkspaceStatus(workspace.id, 'needs_input')
    await terminal.expectScreenToContain('Claude needs your permission to use Bash. Allow? (y/n)')
    await launched.window.screenshot({ path: 'test-results/workspace-needs-input.png' })
  })
})
