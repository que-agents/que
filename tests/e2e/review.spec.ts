// The review journey end to end: a workspace made from the CLI with a file
// edited in its worktree; the top bar opens the review pane on Changes beside
// the terminals, which stay as they are; clicking the file opens its diff as a
// tab beside the terminal tab (once, however often it is clicked); the pane
// drags wider; Pull request shows no pull request, then one appears (through
// the fake GitHub CLI) with its checks and conversation, and Refresh picks up a
// new comment; the app quits and relaunches on the same home and the pane, its
// tab, its width and the diff tab come back; ⌘W closes the diff tab, and the
// pane closes and opens again.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Project, Workspace } from '../../src/shared/types'
import {
  fakeCheckRun,
  fakeComment,
  fakeLineComment,
  fakeReview,
  setFakePullRequest
} from '../../src/testing/fakes'
import { ChangesPage } from './pages/ChangesPage'
import { DiffPage } from './pages/DiffPage'
import { PullRequestPage } from './pages/PullRequestPage'
import { ReviewPage } from './pages/ReviewPage'
import { SidebarPage } from './pages/SidebarPage'
import { TerminalPage } from './pages/TerminalPage'
import { type LaunchedApp, launchApp, newQueHome } from './utils/app'
import { queJson } from './utils/que'
import { makeRepo } from './utils/repo'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close() // quits the app AND stops the test daemon
})

test('The review pane lists the changes beside the terminals, opens diffs as tabs, and survives a relaunch', async () => {
  const repo = makeRepo({ origin: true })
  // The tracker polls every second here, so a pull request shows up right after it is seeded.
  const queHome = newQueHome('pr_poll_seconds = 1\n[quiet_hours]\nenabled = false\n')
  const prsFile = join(queHome, 'fake-gh-prs.json')
  let project: Project
  let workspace: Workspace
  let sidebar: SidebarPage
  let terminal: TerminalPage
  let review: ReviewPage
  let changes: ChangesPage
  let diff: DiffPage
  let pr: PullRequestPage
  let termId = ''
  let widened = 0

  const pages = (): void => {
    sidebar = new SidebarPage(launched.window)
    terminal = new TerminalPage(launched.window)
    review = new ReviewPage(launched.window)
    changes = new ChangesPage(launched.window)
    diff = new DiffPage(launched.window)
    pr = new PullRequestPage(launched.window)
  }

  await test.step('A project and a workspace from the CLI', async () => {
    project = queJson<Project>(queHome, 'project', 'add', repo, '--json')
    workspace = queJson<Workspace>(queHome, 'work', 'APP-1432 retry logic', '-r', repo, '--json')
    expect(workspace.projectId).toBe(project.id)
  })

  await test.step('Launch the app and open the workspace', async () => {
    launched = await launchApp({ queHome })
    pages()
    await sidebar.waitForLoad()
    await sidebar.waitForWorkspaceStatus(workspace.id, 'idle')
    await sidebar.workspaceOpen(workspace.id).click()
    termId = await terminal.waitForActiveTerminal()
  })

  await test.step('Edit a file; Changes opens the review pane beside the terminal', async () => {
    writeFileSync(join(workspace.path, 'README.md'), '# uploader\n\nRetries with backoff.\n')
    await changes.toggle.click()
    await expect(review.root).toBeVisible()
    await expect(review.root).toHaveAttribute('data-tab', 'changes')
    await expect(changes.toggle).toHaveAttribute('aria-pressed', 'true')
    expect(await review.state()).toMatchObject({ open: true, tab: 'changes' })
    await expect(terminal.tab(termId)).toBeVisible()
    await expect(terminal.viewport).toBeVisible()
    await expect.poll(async () => (await terminal.panes())[0]?.activeTab).toBe(termId)
    await expect(changes.summary).toContainText('1 file')
    await expect(changes.file(0)).toContainText('README.md')
    await expect(changes.file(0)).toContainText('+2')
    await expect(changes.file(0)).toHaveAttribute('data-path', 'README.md')
  })

  await test.step('Clicking the file opens its diff as a tab beside the terminal tab', async () => {
    await changes.file(0).click()
    await expect(diff.tab('README.md')).toHaveAttribute('data-active', 'true')
    await expect(terminal.pane(0).diffTabs).toHaveCount(1)
    await expect(terminal.tab(termId)).toBeVisible()
    await expect(diff.root).toHaveAttribute('data-path', 'README.md')
    await expect(diff.header).toContainText('README.md · +2')
    await expect(diff.patch).toContainText('+Retries with backoff.')
    await expect(changes.file(0)).toHaveAttribute('data-active', 'true')
    await expect
      .poll(async () => (await terminal.panes())[0]?.activeTab)
      .toBe('view:diff:README.md')
    await launched.window.screenshot({ path: 'test-results/review-changes.png' })
  })

  await test.step('Back on the terminal, the file again focuses the same diff tab', async () => {
    await terminal.tabSelect(termId).click()
    await expect(terminal.viewport).toBeVisible()
    await expect(changes.file(0)).toHaveAttribute('data-active', 'false')
    await changes.file(0).click()
    await expect(diff.tabs).toHaveCount(1)
    await expect(diff.tab('README.md')).toHaveAttribute('data-active', 'true')
    await expect(diff.patch).toContainText('+Retries with backoff.')
  })

  await test.step('Dragging the resizer 80px left widens the pane by about 80px', async () => {
    const before = (await review.state()).width
    expect(before).toBe(320)
    const box = await review.resizer.boundingBox()
    expect(box).not.toBeNull()
    const { x, y, width, height } = box as { x: number; y: number; width: number; height: number }
    await launched.window.mouse.move(x + width / 2, y + height / 2)
    await launched.window.mouse.down()
    await launched.window.mouse.move(x + width / 2 - 80, y + height / 2, { steps: 6 })
    await launched.window.mouse.up()
    await expect.poll(async () => (await review.state()).width).toBeGreaterThanOrEqual(before + 76)
    widened = (await review.state()).width
    expect(widened).toBeLessThanOrEqual(before + 84)
    await expect(review.resizer).toHaveAttribute('aria-valuenow', String(widened))
    await launched.window.screenshot({ path: 'test-results/review-pane.png' })
  })

  await test.step('Pull request switches the pane over: no pull request yet', async () => {
    await pr.toggle.click()
    await expect(review.root).toHaveAttribute('data-tab', 'pr')
    await expect(review.tabPr).toHaveAttribute('aria-selected', 'true')
    await expect(pr.toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(changes.toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(pr.empty).toHaveText('No pull request yet')
    await expect(pr.create).toBeVisible()
    expect(await review.state()).toMatchObject({ open: true, tab: 'pr' })
    await expect(diff.tab('README.md')).toBeVisible()
  })

  await test.step('A pull request appears: its checks and conversation fill the pane', async () => {
    setFakePullRequest(prsFile, workspace.branch, {
      number: 7,
      url: 'https://github.com/rquellh/que/pull/7',
      title: 'Add retry logic',
      isDraft: false,
      reviewDecision: 'CHANGES_REQUESTED',
      updatedAt: '2026-10-14T03:05:00Z',
      statusCheckRollup: [
        fakeCheckRun({ name: 'build' }),
        fakeCheckRun({
          name: 'lint',
          conclusion: 'FAILURE',
          detailsUrl: 'https://github.com/rquellh/que/actions/runs/42'
        })
      ],
      comments: [
        fakeComment({
          author: 'reviewer',
          body: 'Looks close. One nit below.',
          createdAt: '2026-10-14T03:00:00Z'
        })
      ],
      reviews: [
        fakeReview({
          author: 'reviewer',
          state: 'CHANGES_REQUESTED',
          body: 'Please add a test for the retry cap.',
          submittedAt: '2026-10-14T03:02:00Z'
        })
      ],
      lineComments: [
        fakeLineComment({
          author: 'reviewer',
          body: 'Backoff should be capped.',
          path: 'README.md',
          line: 3,
          createdAt: '2026-10-14T03:01:00Z'
        })
      ]
    })
    await expect(pr.headerLink).toContainText('#7 · open · Add retry logic', { timeout: 15_000 })
    await expect(pr.headerLink).toHaveAttribute('href', 'https://github.com/rquellh/que/pull/7')
    await expect(pr.review).toHaveAttribute('data-review', 'changes_requested')
    await expect(pr.checksSummary).toHaveText('1 passing · 1 failing')
    await expect(pr.check(0)).toHaveAttribute('data-state', 'failing')
    await expect(pr.check(0)).toContainText('lint')
    await expect(pr.checkLink(0)).toHaveAttribute(
      'href',
      'https://github.com/rquellh/que/actions/runs/42'
    )
    await expect(pr.check(1)).toHaveAttribute('data-state', 'passing')
    await expect(pr.check(1)).toContainText('build')
    // Oldest first: the comment, the line comment, then the review.
    await expect(pr.comment(0)).toHaveAttribute('data-kind', 'comment')
    await expect(pr.comment(0)).toContainText('Looks close. One nit below.')
    await expect(pr.comment(1)).toHaveAttribute('data-kind', 'line')
    await expect(pr.comment(1)).toContainText('README.md:3')
    await expect(pr.comment(1)).toContainText('Backoff should be capped.')
    await expect(pr.comment(2)).toHaveAttribute('data-kind', 'review')
    await expect(pr.comment(2)).toContainText('changes requested')
    await expect(pr.comment(2)).toContainText('Please add a test for the retry cap.')
    await expect(pr.footerLink).toHaveAttribute('href', 'https://github.com/rquellh/que/pull/7')
    await launched.window.screenshot({ path: 'test-results/review-pull-request-filled.png' })
  })

  await test.step('Refresh fetches the conversation again and shows a new comment', async () => {
    setFakePullRequest(prsFile, workspace.branch, {
      comments: [
        fakeComment({
          author: 'reviewer',
          body: 'Looks close. One nit below.',
          createdAt: '2026-10-14T03:00:00Z'
        }),
        fakeComment({
          author: 'author',
          body: 'Capped it; test added.',
          createdAt: '2026-10-14T03:10:00Z'
        })
      ]
    })
    await pr.refresh.click()
    await expect(pr.comment(3)).toContainText('Capped it; test added.')
    await expect(pr.comment(3)).toHaveAttribute('data-kind', 'comment')
  })

  await test.step('Quit the app; relaunch on the same home: the pane and the diff tab come back', async () => {
    await launched.app.close() // the app only, NOT launched.close(), which also stops the daemon
    launched = await launchApp({ queHome: launched.queHome })
    pages()
    await sidebar.waitForLoad()
    await sidebar.workspaceOpen(workspace.id).click()
    await expect(review.root).toHaveAttribute('data-tab', 'pr')
    expect(await review.state()).toEqual({ open: true, tab: 'pr', width: widened })
    await expect(pr.headerLink).toContainText('#7 · open · Add retry logic')
    await expect(terminal.pane(0).diffTabs).toHaveCount(1)
    await expect(diff.tab('README.md')).toHaveAttribute('data-active', 'true')
    await expect(diff.patch).toContainText('+Retries with backoff.')
    await expect(terminal.tab(termId)).toBeVisible()
  })

  await test.step('⌘W closes the selected diff tab; the terminal tab is active again', async () => {
    await diff.tabSelect('README.md').click()
    await launched.window.keyboard.press('Meta+w')
    await expect(diff.tabs).toHaveCount(0)
    await expect(diff.root).toHaveCount(0)
    await expect.poll(async () => (await terminal.panes())[0]?.activeTab).toBe(termId)
    await expect(terminal.viewport).toBeVisible()
    await expect(terminal.tab(termId)).toBeVisible()
  })

  await test.step('The close button closes the pane; Changes opens it again on Changes', async () => {
    await review.close.click()
    await expect(review.root).toHaveCount(0)
    expect((await review.state()).open).toBe(false)
    await changes.toggle.click()
    await expect(review.root).toHaveAttribute('data-tab', 'changes')
    await expect(changes.file(0)).toContainText('README.md')
    expect(await review.state()).toEqual({ open: true, tab: 'changes', width: widened })
  })
})
