// The selected workspace's header: name, branch, status, and its actions with
// their dialogs (create draft PR, hand off).
import type { Locator, Page } from '@playwright/test'

export class TopBarPage {
  page: Page
  root: Locator
  title: Locator
  branch: Locator
  status: Locator
  prLink: Locator
  openEditorButton: Locator
  createPrButton: Locator
  handoffButton: Locator
  createPrDialog: Locator
  createPrTitle: Locator
  createPrSubmit: Locator
  createPrUrl: Locator
  handoffDialog: Locator
  handoffBrief: Locator
  handoffSubmit: Locator
  unlockCountdown: Locator
  lockButton: Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('topbar')
    this.title = page.getByTestId('topbar-title')
    this.branch = page.getByTestId('topbar-branch')
    this.status = page.getByTestId('topbar-status')
    this.prLink = page.getByTestId('topbar-pr')
    this.openEditorButton = page.getByTestId('topbar-open-editor')
    this.createPrButton = page.getByTestId('topbar-create-pr')
    this.handoffButton = page.getByTestId('topbar-handoff')
    this.createPrDialog = page.getByTestId('dialog-create-pr')
    this.createPrTitle = page.getByTestId('dialog-create-pr-title')
    this.createPrSubmit = page.getByTestId('dialog-create-pr-submit')
    this.createPrUrl = page.getByTestId('dialog-create-pr-url')
    this.handoffDialog = page.getByTestId('dialog-handoff')
    this.handoffBrief = page.getByTestId('dialog-handoff-brief')
    this.handoffSubmit = page.getByTestId('dialog-handoff-submit')
    this.unlockCountdown = page.getByTestId('topbar-unlock-countdown')
    this.lockButton = page.getByTestId('topbar-lock')
  }
}
