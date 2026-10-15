// A file's diff tab in a pane's tab strip, beside the session tabs, and the
// diff it shows. Tabs are keyed by the file's path (the diff has no other id).
import type { Locator, Page } from '@playwright/test'

export class DiffPage {
  page: Page
  root: Locator
  header: Locator
  patch: Locator
  empty: Locator
  error: Locator
  tab: (path: string) => Locator
  tabSelect: (path: string) => Locator
  tabClose: (path: string) => Locator
  // Every diff tab, in any pane.
  tabs: Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('diff-view')
    this.header = page.getByTestId('diff-header')
    this.patch = page.getByTestId('diff-patch')
    this.empty = page.getByTestId('diff-empty')
    this.error = page.getByTestId('diff-error')
    this.tabs = page.getByTestId('view-tab-diff')
    this.tab = (path) => page.locator(`[data-testid="view-tab-diff"][data-path="${path}"]`)
    this.tabSelect = (path) =>
      page.locator(`[data-testid="view-tab-diff-select"][data-path="${path}"]`)
    this.tabClose = (path) =>
      page.locator(`[data-testid="view-tab-diff-close"][data-path="${path}"]`)
  }
}
