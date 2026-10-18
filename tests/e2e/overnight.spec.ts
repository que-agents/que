// The overnight journey: a task queued and run from the CLI, its workspace
// appearing in the sidebar while it runs, the task finishing through the fake
// claude and the finisher's draft PR (fake gh, real push to a bare origin),
// the sidebar row reading done and unseen with the PR as its word, the review
// pane's Pull request tab following the PR from draft to merged once it is selected, the tray title
// settling back to all clear, and the report listing it under done.
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Project, Task } from '../../src/shared/types'
import { setFakePullRequest } from '../../src/testing/fakes'
import { addBareOrigin, makeTempRepo } from '../../src/testing/temp-repo'
import { AppShellPage } from './pages/AppShellPage'
import { PullRequestPage } from './pages/PullRequestPage'
import { ReportPage } from './pages/ReportPage'
import { ReviewPage } from './pages/ReviewPage'
import { SidebarPage } from './pages/SidebarPage'
import { TabRowPage } from './pages/TabRowPage'
import { type LaunchedApp, launchApp, newQueHome, tempDir } from './utils/app'
import { que, queJson } from './utils/que'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close() // quits the app AND stops the test daemon
})

test('a task queued from the CLI runs overnight-style, shows in the sidebar, and lands in the report as a draft PR', async () => {
  const repo = makeTempRepo(tempDir('que-e2e-repo-'))
  addBareOrigin(repo)
  // The PR tracker polls every second here, so the chip follows the fake state fast.
  const queHome = newQueHome('pr_poll_seconds = 1\n[quiet_hours]\nenabled = false\n')
  let project: Project
  let taskId = ''
  let workspaceId = ''
  let sidebar: SidebarPage
  let report: ReportPage
  let shell: AppShellPage
  let tabRow: TabRowPage
  let review: ReviewPage
  let pr: PullRequestPage

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
    tabRow = new TabRowPage(launched.window)
    review = new ReviewPage(launched.window)
    pr = new PullRequestPage(launched.window)
    await sidebar.waitForLoad()
    await expect(sidebar.project(project.id)).toBeVisible()
  })

  await test.step('Open the queue; the task runs in a workspace of its own', async () => {
    que(queHome, 'run')
    await expect.poll(() => task()?.workspaceId ?? null, { timeout: 30_000 }).toMatch(/^ws_/)
    workspaceId = task()?.workspaceId ?? ''
    await expect(sidebar.workspace(workspaceId)).toBeVisible()
  })

  await test.step('The task finishes with a draft PR, unseen on its workspace', async () => {
    await sidebar.waitForWorkspaceStatus(workspaceId, 'done', 60_000)
    await expect(sidebar.workspaceStatus(workspaceId)).toHaveAttribute('data-unseen', 'true')
    await sidebar.workspace(workspaceId).hover()
    await expect(sidebar.workspaceWord(workspaceId)).toHaveText(/^done · draft PR #\d+$/)
    expect(launched.ghCalls()).toContainEqual(expect.arrayContaining(['pr', 'create', '--draft']))
    // One chime for the whole run: on done, not when the task's session ended its turn.
    await expect.poll(() => shell.chimes()).toEqual(['complete'])
  })

  await test.step('Selected, the Pull request tab follows the pull request from draft to merged', async () => {
    await sidebar.workspaceOpen(workspaceId).click()
    await expect(sidebar.workspaceStatus(workspaceId)).toHaveAttribute('data-unseen', 'false')
    await tabRow.reviewToggle.click()
    await review.tabPr.click()
    await expect(pr.headerLink).toHaveAttribute('href', /\/pull\/\d+$/)
    await expect(pr.headerLink).toHaveText(/^#\d+ · draft · /, { timeout: 15_000 })
    const branch = task()?.branch as string
    setFakePullRequest(join(queHome, 'fake-gh-prs.json'), branch, {
      state: 'MERGED',
      mergedAt: '2026-10-14T03:00:00Z'
    })
    await expect(pr.headerLink).toHaveText(/^#\d+ · merged · /, { timeout: 15_000 })
  })

  await test.step('The tray title counts nothing working, waiting, or stuck', async () => {
    await expect.poll(() => shell.trayTitle()).toBe('● 0 ▸ 0 ✕ 0')
  })

  await test.step('The report lists the task under done with its PR', async () => {
    await sidebar.reportButton.click()
    await report.waitForLoad()
    await expect(report.groupTask('done', taskId)).toBeVisible()
    await expect(report.taskPrLink(taskId)).toHaveAttribute('href', /\/pull\/\d+$/)
    await expect(report.totals).toContainText('1 done · 1 PR')
    await launched.window.screenshot({ path: 'test-results/wp4-overnight.png' })
  })
})
