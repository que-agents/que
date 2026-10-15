// Review in tabs end to end: a workspace made from the CLI with a file edited
// in its worktree; the Changes tab opens beside its terminal tab with the
// file's counts and patch; a split beside takes the Pull request tab; the app
// quits and relaunches on the same home and both view tabs come back in their
// panes; a pull request appears (through the fake GitHub CLI) and the tab fills
// in with its checks and conversation, Refresh picks up a new comment; the top
// bar closes the Changes tab again.
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
import { PullRequestPage } from './pages/PullRequestPage'
import { SidebarPage } from './pages/SidebarPage'
import { TerminalPage } from './pages/TerminalPage'
import { type LaunchedApp, launchApp, newQueHome } from './utils/app'
import { queJson } from './utils/que'
import { makeRepo } from './utils/repo'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close() // quits the app AND stops the test daemon
})

test('Changes and Pull request open as tabs beside the terminals and survive a relaunch', async () => {
  const repo = makeRepo({ origin: true })
  // The tracker polls every second here, so a pull request shows up right after it is seeded.
  const queHome = newQueHome('pr_poll_seconds = 1\n[quiet_hours]\nenabled = false\n')
  const prsFile = join(queHome, 'fake-gh-prs.json')
  let project: Project
  let workspace: Workspace
  let sidebar: SidebarPage
  let terminal: TerminalPage
  let changes: ChangesPage
  let pr: PullRequestPage
  let termId = ''

  const pages = (): void => {
    sidebar = new SidebarPage(launched.window)
    terminal = new TerminalPage(launched.window)
    changes = new ChangesPage(launched.window)
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

  await test.step('Edit a file; Changes opens as a tab beside the terminal tab', async () => {
    writeFileSync(join(workspace.path, 'README.md'), '# uploader\n\nRetries with backoff.\n')
    await changes.toggle.click()
    await expect(terminal.tab(termId)).toBeVisible()
    await expect(terminal.viewTab('changes')).toHaveAttribute('data-active', 'true')
    await expect(changes.root).toBeVisible()
    await expect(changes.summary).toContainText('1 file')
    await expect(changes.file(0)).toContainText('README.md')
    await expect(changes.file(0)).toContainText('+2')
    await expect(changes.patch).toContainText('+Retries with backoff.')
    await launched.window.screenshot({ path: 'test-results/review-changes.png' })
  })

  await test.step('⌘D splits beside with a new terminal in the second pane', async () => {
    await launched.window.keyboard.press('Meta+d')
    await expect(terminal.pane(1).root).toBeVisible()
    await expect.poll(async () => (await terminal.panes())[1]?.activeTermId ?? null).not.toBeNull()
  })

  await test.step('Pull request opens in the focused second pane: no pull request yet', async () => {
    await pr.toggle.click()
    await expect(terminal.pane(1).viewTab('pr')).toHaveAttribute('data-active', 'true')
    await expect(pr.empty).toHaveText('No pull request yet')
    await expect(pr.create).toBeVisible()
    await expect
      .poll(async () => (await terminal.panes()).map((p) => p.activeTab))
      .toEqual(['view:changes', 'view:pr'])
    await launched.window.screenshot({ path: 'test-results/review-pull-request.png' })
  })

  await test.step('Quit the app; relaunch on the same home: both view tabs come back', async () => {
    await launched.app.close() // the app only, NOT launched.close(), which also stops the daemon
    launched = await launchApp({ queHome: launched.queHome })
    pages()
    await sidebar.waitForLoad()
    await sidebar.workspaceOpen(workspace.id).click()
    await expect(terminal.pane(0).viewTab('changes')).toHaveAttribute('data-active', 'true')
    await expect(terminal.pane(1).viewTab('pr')).toHaveAttribute('data-active', 'true')
    await expect(terminal.tab(termId)).toBeVisible()
    await expect(pr.empty).toBeVisible()
    await expect
      .poll(async () => (await terminal.panes()).map((p) => p.activeTab))
      .toEqual(['view:changes', 'view:pr'])
  })

  await test.step('A pull request appears: its checks and conversation fill the tab', async () => {
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

  await test.step('The top bar closes the Changes tab while it is the active tab', async () => {
    await terminal.viewTabSelect('changes').click()
    await expect(changes.toggle).toHaveAttribute('aria-pressed', 'true')
    await changes.toggle.click()
    await expect(terminal.viewTab('changes')).toHaveCount(0)
    await expect(changes.root).toHaveCount(0)
    await expect.poll(async () => (await terminal.panes())[0]?.activeTab).toBe(termId)
    await expect(terminal.pane(0).viewport).toBeVisible()
  })
})
