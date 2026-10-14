// The overnight journey in the app: a task added from the Tonight panel, the
// queue run from its control, the task finishing through the fake claude and
// the finisher's draft PR (fake gh, real push to a bare origin), the report
// listing it under done, and the tray title settling back to all clear.
import { expect, test } from '@playwright/test'
import type { Project, Task } from '../../src/shared/types'
import { AppShellPage } from './pages/AppShellPage'
import { ReportPage } from './pages/ReportPage'
import { SidebarPage } from './pages/SidebarPage'
import { TasksPage } from './pages/TasksPage'
import { type LaunchedApp, launchApp, newQueHome } from './utils/app'
import { queJson } from './utils/que'
import { makeRepo } from './utils/repo'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close() // quits the app AND stops the test daemon
})

test('a task added in the app runs overnight-style and lands in the report as a draft PR', async () => {
  const repo = makeRepo({ origin: true })
  const queHome = newQueHome()
  let project: Project
  let taskId = ''
  let tasks: TasksPage
  let sidebar: SidebarPage
  let report: ReportPage
  let shell: AppShellPage

  await test.step('Register the project with the CLI', async () => {
    project = queJson<Project>(queHome, 'project', 'add', repo, '--json')
  })

  await test.step('Launch the app', async () => {
    launched = await launchApp({ queHome })
    tasks = new TasksPage(launched.window)
    sidebar = new SidebarPage(launched.window)
    report = new ReportPage(launched.window)
    shell = new AppShellPage(launched.window)
    await sidebar.waitForLoad()
    await tasks.waitForLoad()
    await expect(sidebar.project(project.id)).toBeVisible()
  })

  await test.step('Add a task for the project from the dialog', async () => {
    await tasks.addButton.click()
    await expect(tasks.addTarget).toHaveValue(`p:${project.id}`)
    await tasks.addBrief.fill('Add retry logic to the uploader')
    await tasks.addSubmit.click()
    await expect(tasks.addDialog).toHaveCount(0)
    const [task] = queJson<Task[]>(queHome, 'task', 'list', '--json')
    expect(task).toMatchObject({ projectId: project.id, title: 'Add retry logic to the uploader' })
    taskId = task.id
    await expect(tasks.taskState(taskId)).toHaveAttribute('data-status', 'queued')
  })

  await test.step('Run the queue; the task finishes with a draft PR', async () => {
    await tasks.queueRun.click()
    await expect(tasks.queueControl).toHaveAttribute('data-open', 'true')
    await expect(tasks.taskState(taskId)).toHaveAttribute('data-status', 'done', {
      timeout: 60_000
    })
    await expect(tasks.taskPr(taskId)).toHaveAttribute('href', /\/pull\/\d+$/)
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
