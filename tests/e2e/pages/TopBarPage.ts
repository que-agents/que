// The selected workspace's header: name, branch, status, split or join, and the
// review pane toggle; and the create draft PR dialog (opened from the Pull request tab).
import type { Locator, Page } from '@playwright/test'

export class TopBarPage {
  page: Page
  root: Locator
  title: Locator
  branch: Locator
  status: Locator
  prLink: Locator
  splitBesideButton: Locator
  splitBelowButton: Locator
  joinButton: Locator
  reviewToggle: Locator
  createPrDialog: Locator
  createPrTitle: Locator
  createPrSubmit: Locator
  createPrUrl: Locator
  unlockCountdown: Locator
  lockButton: Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('topbar')
    this.title = page.getByTestId('topbar-title')
    this.branch = page.getByTestId('topbar-branch')
    this.status = page.getByTestId('topbar-status')
    this.prLink = page.getByTestId('topbar-pr')
    this.splitBesideButton = page.getByTestId('topbar-split-beside')
    this.splitBelowButton = page.getByTestId('topbar-split-below')
    this.joinButton = page.getByTestId('topbar-join')
    this.reviewToggle = page.getByTestId('topbar-review')
    this.createPrDialog = page.getByTestId('dialog-create-pr')
    this.createPrTitle = page.getByTestId('dialog-create-pr-title')
    this.createPrSubmit = page.getByTestId('dialog-create-pr-submit')
    this.createPrUrl = page.getByTestId('dialog-create-pr-url')
    this.unlockCountdown = page.getByTestId('topbar-unlock-countdown')
    this.lockButton = page.getByTestId('topbar-lock')
  }
}
