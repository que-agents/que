// The controls at the right end of the main column's tab row (the top-right pane's strip):
// split beside and split below, or join while split, and the review pane toggle. Which
// pane's strip holds them is TerminalPage.pane(n).controls.
import type { Locator, Page } from '@playwright/test'

export class TabRowPage {
  page: Page
  controls: Locator
  splitBesideButton: Locator
  splitBelowButton: Locator
  joinButton: Locator
  reviewToggle: Locator

  constructor(page: Page) {
    this.page = page
    this.controls = page.getByTestId('pane-controls')
    this.splitBesideButton = page.getByTestId('topbar-split-beside')
    this.splitBelowButton = page.getByTestId('topbar-split-below')
    this.joinButton = page.getByTestId('topbar-join')
    this.reviewToggle = page.getByTestId('topbar-review')
  }
}
