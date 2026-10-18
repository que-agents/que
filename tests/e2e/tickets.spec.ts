// The ticket journey: the tickets assigned to the user (from the fake tracker
// CLI) listed in the app under their epic, with a working link; one started: que asks which project the first time,
// makes the workspace under it, writes the ticket as a brief, opens the
// workspace terminal and starts claude on the start prompt; the choice is
// remembered in the config file and the ticket row now points at the workspace.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Project, Workspace } from '../../src/shared/types'
import {
  fakeParentOf,
  makeFakeEpic,
  makeFakeIssue,
  writeFakeTickets
} from '../../src/testing/fakes'
import { makeTempRepo } from '../../src/testing/temp-repo'
import { SidebarPage } from './pages/SidebarPage'
import { TicketsPage } from './pages/TicketsPage'
import { type LaunchedApp, launchApp, newQueHome, testEnv, tempDir } from './utils/app'
import { queJson } from './utils/que'

let launched: LaunchedApp

test.afterEach(async () => {
  await launched?.close() // quits the app AND stops the test daemon
})

test('a ticket assigned to me becomes a workspace with claude started on its brief', async () => {
  const repo = makeTempRepo(tempDir('que-e2e-repo-'))
  // Tickets sync every 120 ms here, so the list fills right after launch.
  const queHome = newQueHome('[jira]\npoll_minutes = 0.002\n[quiet_hours]\nenabled = false\n')
  const env = testEnv(queHome)
  const epic = makeFakeEpic()
  writeFakeTickets(env.QUE_FAKE_ACLI_TICKETS, [
    epic,
    makeFakeIssue({ fields: { parent: fakeParentOf(epic) } })
  ])
  let project: Project
  let workspace: Workspace
  let sidebar: SidebarPage
  let tickets: TicketsPage

  await test.step('Register the project with the CLI', async () => {
    project = queJson<Project>(queHome, 'project', 'add', repo, '--json')
  })

  await test.step('Launch the app; the ticket is listed', async () => {
    launched = await launchApp({ queHome })
    sidebar = new SidebarPage(launched.window)
    tickets = new TicketsPage(launched.window)
    await sidebar.waitForLoad()
    await expect(tickets.sidebarCount).toHaveText('1')
    await tickets.sidebarEntry.click()
    await expect(tickets.ticket('APP-1432')).toContainText('Add retry logic to the uploader')
  })

  await test.step('The ticket sits under its epic, which has no Start; the link points at the site', async () => {
    await expect(tickets.epic('APP-1400')).toHaveAttribute('data-level', 'epic')
    await expect(tickets.epic('APP-1400')).toContainText('Uploader reliability')
    await expect(tickets.start('APP-1400')).toHaveCount(0)
    await expect(tickets.ticket('APP-1432')).toHaveAttribute('data-parent', 'APP-1400')
    await expect(tickets.open('APP-1432')).toHaveAttribute(
      'href',
      'https://example.atlassian.net/browse/APP-1432'
    )
  })

  await test.step('Start it; que asks which project the first time', async () => {
    await tickets.start('APP-1432').click()
    await expect(tickets.dialog).toBeVisible()
    await tickets.dialogSelect.selectOption(project.id)
    await tickets.dialogSubmit.click()
    await expect(tickets.dialog).toHaveCount(0)
  })

  await test.step('A workspace under the project, its brief written, its terminal open', async () => {
    await expect
      .poll(
        () =>
          queJson<Workspace[]>(queHome, 'ws', 'list', '--json').find((w) =>
            w.name.startsWith('app-1432-')
          )?.id ?? null,
        { timeout: 20_000 }
      )
      .not.toBeNull()
    workspace = queJson<Workspace[]>(queHome, 'ws', 'list', '--json').find((w) =>
      w.name.startsWith('app-1432-')
    ) as Workspace
    expect(workspace.projectId).toBe(project.id)
    await expect(sidebar.workspace(workspace.id)).toBeVisible()
    await expect(sidebar.workspaceOpen(workspace.id)).toHaveAttribute('aria-current', 'page')
    expect(existsSync(join(workspace.path, '.que', 'ticket.md'))).toBe(true)
    const brief = readFileSync(join(workspace.path, '.que', 'ticket.md'), 'utf8')
    expect(brief).toContain('# APP-1432')
    expect(brief).toContain('## Epic APP-1400: Uploader reliability')
    expect(brief).toContain('Make uploads survive flaky networks')
  })

  await test.step('claude was started on the start prompt', async () => {
    await expect
      .poll(
        () => launched.claudeCalls().some((argv) => argv.join(' ').includes('.que/ticket.md')),
        {
          timeout: 20_000
        }
      )
      .toBe(true)
  })

  await test.step('The choice is remembered and the ticket row points at the workspace', async () => {
    expect(readFileSync(join(queHome, 'config.toml'), 'utf8')).toMatch(/APP\s*=\s*"/)
    await tickets.sidebarEntry.click()
    await expect(tickets.workspaceButton('APP-1432')).toHaveText(workspace.name)
    await launched.window.screenshot({ path: 'test-results/tickets.png' })
  })
})
