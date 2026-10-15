// The tickets view: the assigned tickets, Start on each, and the project dialog.
import type { Locator, Page } from '@playwright/test'

export class TicketsPage {
  page: Page
  sidebarEntry: Locator
  sidebarCount: Locator
  root: Locator
  syncButton: Locator
  error: Locator
  emptyState: Locator
  ticket: (key: string) => Locator
  epic: (key: string) => Locator
  childrenOf: (key: string) => Locator
  unassigned: (key: string) => Locator
  looseLabel: Locator
  start: (key: string) => Locator
  workspaceButton: (key: string) => Locator
  open: (key: string) => Locator
  dialog: Locator
  dialogSelect: Locator
  dialogSubmit: Locator

  constructor(page: Page) {
    this.page = page
    this.sidebarEntry = page.getByTestId('sidebar-tickets')
    this.sidebarCount = page.getByTestId('sidebar-tickets-count')
    this.root = page.getByTestId('tickets-view')
    this.syncButton = page.getByTestId('tickets-sync')
    this.error = page.getByTestId('tickets-error')
    this.emptyState = page.getByTestId('tickets-empty')
    this.ticket = (key: string) => page.getByTestId(`ticket-${key}`)
    this.epic = (key: string) => page.getByTestId(`ticket-${key}`)
    this.childrenOf = (key: string) => page.locator(`[data-parent="${key}"]`)
    this.unassigned = (key: string) => page.getByTestId(`ticket-${key}-unassigned`)
    this.looseLabel = page.getByTestId('tickets-loose')
    this.start = (key: string) => page.getByTestId(`ticket-${key}-start`)
    this.workspaceButton = (key: string) => page.getByTestId(`ticket-${key}-workspace`)
    this.open = (key: string) => page.getByTestId(`ticket-${key}-open`)
    this.dialog = page.getByTestId('dialog-start-ticket')
    this.dialogSelect = page.getByTestId('dialog-start-ticket-project')
    this.dialogSubmit = page.getByTestId('dialog-start-ticket-submit')
  }

  async waitForLoad() {
    await this.root.waitFor({ state: 'visible' })
  }
}
