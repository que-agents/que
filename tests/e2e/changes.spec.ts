// The diff view end to end: a workspace made from the CLI, a file edited in
// its worktree, the Changes view opened from the top bar listing it with its
// counts and patch, and the view closed again.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Project, Workspace } from '../../src/shared/types'
import { ChangesPage } from './pages/ChangesPage'
import { SidebarPage } from './pages/SidebarPage'
import { TerminalPage } from './pages/TerminalPage'
import { type LaunchedApp, launchApp, newQueHome } from './utils/app'
import { queJson } from './utils/que'
import { makeRepo } from './utils/repo'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close() // quits the app AND stops the test daemon
})

test('the Changes view shows what a workspace changed against its base', async () => {
  const repo = makeRepo({ origin: true })
  const queHome = newQueHome()
  let project: Project
  let workspace: Workspace
  let sidebar: SidebarPage
  let changes: ChangesPage

  await test.step('A project and a workspace from the CLI', async () => {
    project = queJson<Project>(queHome, 'project', 'add', repo, '--json')
    workspace = queJson<Workspace>(queHome, 'work', 'APP-1432 retry logic', '-r', repo, '--json')
    expect(workspace.projectId).toBe(project.id)
  })

  await test.step('Launch the app and open the workspace', async () => {
    launched = await launchApp({ queHome })
    sidebar = new SidebarPage(launched.window)
    changes = new ChangesPage(launched.window)
    await sidebar.waitForLoad()
    await sidebar.waitForWorkspaceStatus(workspace.id, 'idle')
    await sidebar.workspaceOpen(workspace.id).click()
    await new TerminalPage(launched.window).waitForActiveTerminal()
  })

  await test.step('Edit a file in the worktree and open Changes', async () => {
    writeFileSync(join(workspace.path, 'README.md'), '# uploader\n\nRetries with backoff.\n')
    await changes.toggle.click()
    await expect(changes.root).toBeVisible()
    await expect(changes.summary).toContainText('1 file')
    await expect(changes.file(0)).toContainText('README.md')
    await expect(changes.file(0)).toContainText('+2')
    await expect(changes.patch).toContainText('+Retries with backoff.')
    await launched.window.screenshot({ path: 'test-results/changes.png' })
  })

  await test.step('Close Changes; the terminals are back', async () => {
    await changes.toggle.click()
    await expect(changes.root).toHaveCount(0)
    await expect(new TerminalPage(launched.window).pane(0).root).toBeVisible()
  })
})
