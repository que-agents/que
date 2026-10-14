// Work mode end to end: a project registered with the CLI, a workspace made
// from the sidebar dialog, its terminal opened automatically, a claude session
// in it reaching needs input on the sidebar badge (and in `que status`), and
// Open in editor launching the editor on the worktree.
import { expect, test } from '@playwright/test'
import type { StatusJson } from '../../src/cli/workspaces'
import type { TermInfo } from '../../src/shared/protocol'
import type { Project, Workspace } from '../../src/shared/types'
import { SidebarPage } from './pages/SidebarPage'
import { TerminalPage } from './pages/TerminalPage'
import { TopBarPage } from './pages/TopBarPage'
import { type LaunchedApp, launchApp, newQueHome } from './utils/app'
import { queJson } from './utils/que'
import { makeRepo } from './utils/repo'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close() // quits the app AND stops the test daemon
})

test('a workspace made in the sidebar runs claude, shows needs input, and opens in the editor', async () => {
  const repo = makeRepo()
  const queHome = newQueHome()
  let project: Project
  let workspace: Workspace
  let termId = ''
  let sidebar: SidebarPage
  let terminal: TerminalPage
  let topbar: TopBarPage
  const statusOf = () =>
    queJson<StatusJson>(queHome, 'status', '--json').workspaces.find((w) => w.id === workspace.id)

  await test.step('Register the project with the CLI', async () => {
    project = queJson<Project>(queHome, 'project', 'add', repo, '--json')
    expect(project.defaultBranch).toBe('main')
  })

  await test.step('Launch the app; the project is in the sidebar', async () => {
    launched = await launchApp({ queHome })
    sidebar = new SidebarPage(launched.window)
    terminal = new TerminalPage(launched.window)
    topbar = new TopBarPage(launched.window)
    await sidebar.waitForLoad()
    await expect(sidebar.project(project.id)).toBeVisible()
  })

  await test.step('Create a workspace from the dialog', async () => {
    await sidebar.projectAddWorkspace(project.id).click()
    await sidebar.newWorkspaceName.fill('APP-1432 retry logic')
    await expect(sidebar.newWorkspaceSlug).toHaveText('Branch and folder: app-1432-retry-logic')
    await sidebar.newWorkspaceSubmit.click()
    await expect(sidebar.newWorkspaceDialog).toHaveCount(0)
    const created = queJson<Workspace[]>(queHome, 'ws', 'list', '--json').find(
      (w) => w.name === 'app-1432-retry-logic'
    )
    expect(created).toBeDefined()
    workspace = created as Workspace
    await expect(sidebar.workspace(workspace.id)).toBeVisible()
    await expect(topbar.title).toHaveText('app-1432-retry-logic')
  })

  await test.step('Its first terminal opens as a tab, in the worktree', async () => {
    await expect
      .poll(
        () =>
          queJson<TermInfo[]>(queHome, 'term', 'list', '--json').find(
            (t) => t.workspaceId === workspace.id && t.alive
          )?.id ?? null,
        { message: 'no workspace terminal' }
      )
      .not.toBeNull()
    termId = queJson<TermInfo[]>(queHome, 'term', 'list', '--json').find(
      (t) => t.workspaceId === workspace.id
    )?.id as string
    await expect(terminal.tab(termId)).toBeVisible()
    await expect.poll(() => terminal.activeTermId()).toBe(termId)
  })

  await test.step('Start claude; the session reports in', async () => {
    await terminal.input.focus()
    await launched.window.keyboard.type('claude')
    await launched.window.keyboard.press('Enter')
    await expect
      .poll(() => statusOf()?.sessionId ?? null, { message: 'no session', timeout: 30_000 })
      .toMatch(/^[0-9a-f-]{36}$/)
  })

  await test.step('Ask for something that needs permission; the badge says needs input', async () => {
    await launched.window.keyboard.type('/needs-input')
    await launched.window.keyboard.press('Enter')
    await sidebar.waitForWorkspaceStatus(workspace.id, 'needs_input')
    await expect(sidebar.workspaceStatus(workspace.id)).toHaveText('needs input')
    await expect(topbar.status).toHaveAttribute('data-status', 'needs_input')
    expect(statusOf()?.status).toBe('needs_input')
  })

  await test.step('Open in editor launches the editor on the worktree', async () => {
    await topbar.openEditorButton.click()
    await expect.poll(() => launched.codeCalls()).toContainEqual(['-n', workspace.path])
    await launched.window.screenshot({ path: 'test-results/wp4-work-mode.png' })
  })
})
