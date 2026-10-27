// Claude plan usage end to end: a fake claude session in a workspace terminal reports its
// rate limits through que's status line, the sidebar foot's strip reads the five-hour and
// weekly numbers at its right end, and a click opens the card with when each window resets.
import { expect, test } from '@playwright/test'
import { hhmm } from '../../src/shared/format'
import type { Project, Workspace } from '../../src/shared/types'
import { formatWeekdayClock } from '../../src/shared/usage'
import { makeTempRepo } from '../../src/testing/temp-repo'
import { AppShellPage } from './pages/AppShellPage'
import { SidebarPage } from './pages/SidebarPage'
import { TerminalPage } from './pages/TerminalPage'
import { type LaunchedApp, launchApp, tempDir } from './utils/app'
import { que, queJson } from './utils/que'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close() // quits the app AND stops the test daemon
})

test('a session’s rate limits show in the sidebar foot, and the card says when they reset', async () => {
  const repo = makeTempRepo(tempDir('que-e2e-repo-'))
  let workspace: Workspace
  let terminal: TerminalPage
  let sidebar: SidebarPage
  // Whole minutes ahead, in Unix seconds as the real CLI sends them.
  const fiveHourReset = Math.ceil((Date.now() + 2 * 3_600_000) / 60_000) * 60
  const weeklyReset = Math.ceil((Date.now() + 5 * 86_400_000) / 60_000) * 60

  await test.step('Launch the app on a fresh QUE_HOME; the foot has no reading yet', async () => {
    launched = await launchApp()
    await new AppShellPage(launched.window).waitForLoad()
    terminal = new TerminalPage(launched.window)
    sidebar = new SidebarPage(launched.window)
    await terminal.waitForActiveTerminal()
    await expect(sidebar.usageButton).toHaveAccessibleName('Claude usage: no reading yet')
    await expect(sidebar.usageFiveHour).toHaveText('—')
  })

  await test.step('Add the project and create a workspace with the CLI', async () => {
    queJson<Project>(launched.queHome, 'project', 'add', repo, '--json')
    workspace = queJson<Workspace>(
      launched.queHome,
      'work',
      '--name',
      'APP-1432 retry logic',
      '-r',
      repo,
      '--json'
    )
  })

  await test.step('Open its terminal and start claude', async () => {
    const termId = que(launched.queHome, 'ws', 'terminal', workspace.id).trim()
    await sidebar.workspaceOpen(workspace.id).click()
    await terminal.tabSelect(termId).click()
    await expect.poll(() => terminal.activeTermId()).toBe(termId)
    await terminal.input.focus()
    await launched.window.keyboard.type('claude')
    await launched.window.keyboard.press('Enter')
    await expect
      .poll(() => terminal.screenText(), { message: 'claude never started', timeout: 30_000 })
      .toContain('(fake)')
  })

  await test.step('The session’s status line reports its rate limits; the foot reads them', async () => {
    const limits = {
      five_hour: { used_percentage: 42, resets_at: fiveHourReset },
      seven_day: { used_percentage: 18, resets_at: weeklyReset }
    }

    await launched.window.keyboard.type(`/statusline ${JSON.stringify(limits)}`)
    await launched.window.keyboard.press('Enter')
    await expect(sidebar.usageButton).toHaveAccessibleName('Claude usage: 5-hour 42%, weekly 18%', {
      timeout: 30_000
    })
    await expect(sidebar.usageButton).toHaveText(/^5h 42%\s*wk 18%$/)
  })

  await test.step('A click opens the card with when each window resets', async () => {
    await sidebar.usageButton.click()
    await expect(sidebar.usageCard).toBeVisible()
    await expect(sidebar.usageCardFiveHour).toContainText(
      `resets ${hhmm(fiveHourReset * 1000)} · in `
    )
    await expect(sidebar.usageCardWeekly).toContainText(
      `resets ${formatWeekdayClock(weeklyReset * 1000)}`
    )
    const name = (await sidebar.workspaceName(workspace.id).textContent()) ?? ''
    await expect(sidebar.usageCardAsOf).toHaveText(new RegExp(`^as of \\d\\d:\\d\\d · ${name}$`))

    // The foot and the card beside it, together.
    const foot = await sidebar.foot.boundingBox()
    const card = await sidebar.usageCard.boundingBox()
    expect(foot && card).toBeTruthy()
    const top = Math.min(foot!.y, card!.y) - 8
    await launched.window.screenshot({
      path: 'test-results/usage-foot-card.png',
      clip: {
        x: foot!.x,
        y: top,
        width: card!.x + card!.width + 8 - foot!.x,
        height: foot!.y + foot!.height - top
      }
    })
  })

  await test.step('A second click closes it', async () => {
    await sidebar.usageButton.click()
    await expect(sidebar.usageCard).toBeHidden()
  })
})
