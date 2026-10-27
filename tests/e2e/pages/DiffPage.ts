// A file's diff tab in a pane's tab strip, beside the session tabs, and the
// diff it shows. Tabs are keyed by the file's path (the diff has no other id); a
// pull request's own diff of a file is keyed by its number too (`prTab`), and its
// header says what it is against (`#8 vs #7`).
import type { Locator, Page } from '@playwright/test'

export class DiffPage {
  page: Page
  root: Locator
  header: Locator
  patch: Locator
  empty: Locator
  error: Locator
  against: Locator
  tab: (path: string) => Locator
  tabSelect: (path: string) => Locator
  tabClose: (path: string) => Locator
  prTab: (number: number, path: string) => Locator
  prTabClose: (number: number, path: string) => Locator
  // The patch line a line comment asked for.
  target: Locator
  // Every diff tab, in any pane.
  tabs: Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('diff-view')
    this.header = page.getByTestId('diff-header')
    this.patch = page.getByTestId('diff-patch')
    this.empty = page.getByTestId('diff-empty')
    this.error = page.getByTestId('diff-error')
    this.against = page.getByTestId('diff-against')
    this.target = this.patch.locator('[data-target]')
    this.tabs = page.getByTestId('view-tab-diff')
    this.tab = (path) =>
      page.locator(`[data-testid="view-tab-diff"][data-path="${path}"]:not([data-pr])`)
    this.prTab = (number, path) =>
      page.locator(`[data-testid="view-tab-diff"][data-path="${path}"][data-pr="${number}"]`)
    this.prTabClose = (number, path) =>
      page.locator(`[data-testid="view-tab-diff-close"][data-path="${path}"][data-pr="${number}"]`)
    this.tabSelect = (path) =>
      page.locator(`[data-testid="view-tab-diff-select"][data-path="${path}"]:not([data-pr])`)
    this.tabClose = (path) =>
      page.locator(`[data-testid="view-tab-diff-close"][data-path="${path}"]:not([data-pr])`)
  }
}
