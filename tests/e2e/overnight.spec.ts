// The overnight journey: a task queued and run from the CLI, its workspace
// appearing in the sidebar while it runs, the task finishing through the fake
// claude and the finisher's draft PR (fake gh, real push to a bare origin),
// the sidebar showing done with the PR, the tray title settling back to all
// clear, and the report listing it under done.
import { expect, test } from '@playwright/test'
import type { Project, Task } from '../../src/shared/types'
import { AppShellPage } from './pages/AppShellPage'
import { ReportPage } from './pages/ReportPage'
import { SidebarPage } from './pages/SidebarPage'
import { type LaunchedApp, launchApp, newQueHome } from './utils/app'
import { que, queJson } from './utils/que'
import { makeRepo } from './utils/repo'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close() // quits the app AND stops the test daemon
})

test('a task queued from the CLI runs overnight-style, shows in the sidebar, and lands in the report as a draft PR', async () => {
  const repo = makeRepo({ origin: true })
  const queHome = newQueHome()
  let project: Project
  let taskId = ''
  let workspaceId = ''
  let sidebar: SidebarPage
  let report: ReportPage
  let shell: AppShellPage

  const task = (): Task | undefined =>
    queJson<Task[]>(queHome, 'task', 'list', '--json').find((t) => t.id === taskId)

  await test.step('Register the project and queue a task with the CLI', async () => {
    project = queJson<Project>(queHome, 'project', 'add', repo, '--json')
    const added = queJson<Task>(
      queHome,
      'add',
      '-r',
      repo,
      'Add retry logic to the uploader',
      '--json'
    )
    expect(added).toMatchObject({
      projectId: project.id,
      title: 'Add retry logic to the uploader',
      state: 'queued'
    })
    taskId = added.id
  })

  await test.step('Launch the app', async () => {
    launched = await launchApp({ queHome })
    sidebar = new SidebarPage(launched.window)
    report = new ReportPage(launched.window)
    shell = new AppShellPage(launched.window)
    await sidebar.waitForLoad()
    await expect(sidebar.project(project.id)).toBeVisible()
  })

  await test.step('Open the queue; the task runs in a workspace of its own', async () => {
    que(queHome, 'run')
    await expect.poll(() => task()?.workspaceId ?? null, { timeout: 30_000 }).toMatch(/^ws_/)
    workspaceId = task()?.workspaceId ?? ''
    await expect(sidebar.workspace(workspaceId)).toBeVisible()
  })

  await test.step('The task finishes with a draft PR, shown on its workspace', async () => {
    await sidebar.waitForWorkspaceStatus(workspaceId, 'done', 60_000)
    await expect(sidebar.workspacePr(workspaceId)).toHaveAttribute('href', /\/pull\/\d+$/)
    expect(launched.ghCalls()).toContainEqual(expect.arrayContaining(['pr', 'create', '--draft']))
  })

  await test.step('The tray title counts nothing working, waiting, or stuck', async () => {
    await expect.poll(() => shell.trayTitle()).toBe('● 0 ▸ 0 ✕ 0')
  })

  await test.step('The report lists the task under done with its PR', async () => {
    await sidebar.reportButton.click()
    await report.waitForLoad()
    await expect(report.groupTask('done', taskId)).toBeVisible()
    await expect(report.taskPrLink(taskId)).toHaveAttribute('href', /\/pull\/\d+$/)
    await expect(report.totals).toContainText('1 tasks · 1 PRs')
    await launched.window.screenshot({ path: 'test-results/wp4-overnight.png' })
  })
})
