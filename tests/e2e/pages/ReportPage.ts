// The report view: tasks grouped by outcome, rows keyed by task id.
import type { Locator, Page } from '@playwright/test'

export class ReportPage {
  page: Page
  root: Locator
  refreshButton: Locator
  since: Locator
  totals: Locator
  unlocks: Locator
  emptyState: Locator
  group: (group: string) => Locator
  groupTask: (group: string, id: string) => Locator
  task: (id: string) => Locator
  taskState: (id: string) => Locator
  taskPrLink: (id: string) => Locator
  workspacesSection: Locator
  workspace: (id: string) => Locator
  workspaceState: (id: string) => Locator
  workspaceFacts: (id: string) => Locator
  workspacePrLink: (id: string) => Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('report-view')
    this.refreshButton = page.getByTestId('report-refresh')
    this.since = page.getByTestId('report-since')
    this.totals = page.getByTestId('report-totals')
    this.unlocks = page.getByTestId('report-unlocks')
    this.emptyState = page.getByTestId('report-empty')
    this.group = (group: string) => page.getByTestId(`report-group-${group}`)
    this.groupTask = (group: string, id: string) =>
      page.getByTestId(`report-group-${group}`).getByTestId(`report-task-${id}`)
    this.task = (id: string) => page.getByTestId(`report-task-${id}`)
    this.taskState = (id: string) => page.getByTestId(`report-task-${id}-state`)
    this.taskPrLink = (id: string) => page.getByTestId(`report-task-${id}-pr`)
    this.workspacesSection = page.getByTestId('report-workspaces')
    this.workspace = (id: string) => page.getByTestId(`report-workspace-${id}`)
    this.workspaceState = (id: string) => page.getByTestId(`report-workspace-${id}-status`)
    this.workspaceFacts = (id: string) => page.getByTestId(`report-workspace-${id}-facts`)
    this.workspacePrLink = (id: string) => page.getByTestId(`report-workspace-${id}-pr`)
  }

  async waitForLoad() {
    await this.root.waitFor({ state: 'visible' })
    await this.totals.waitFor({ state: 'visible' })
  }
}
