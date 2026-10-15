// A worktree file's tab in a pane's tab strip, beside the session tabs, and the
// read-only text it shows. Tabs are keyed by the file's path (the file has no other id).
import type { Locator, Page } from '@playwright/test'

export class FileViewPage {
  page: Page
  root: (path: string) => Locator
  header: Locator
  text: Locator
  loading: Locator
  binary: Locator
  truncated: Locator
  missing: Locator
  error: Locator
  tab: (path: string) => Locator
  tabSelect: (path: string) => Locator
  tabClose: (path: string) => Locator
  // Every file tab, in any pane.
  tabs: Locator

  constructor(page: Page) {
    this.page = page
    this.root = (path) => page.locator(`[data-testid="file-view"][data-path="${path}"]`)
    this.header = page.getByTestId('file-header')
    this.text = page.getByTestId('file-text')
    this.loading = page.getByTestId('file-loading')
    this.binary = page.getByTestId('file-binary')
    this.truncated = page.getByTestId('file-truncated')
    this.missing = page.getByTestId('file-missing')
    this.error = page.getByTestId('file-error')
    this.tabs = page.getByTestId('view-tab-file')
    this.tab = (path) => page.locator(`[data-testid="view-tab-file"][data-path="${path}"]`)
    this.tabSelect = (path) =>
      page.locator(`[data-testid="view-tab-file-select"][data-path="${path}"]`)
    this.tabClose = (path) =>
      page.locator(`[data-testid="view-tab-file-close"][data-path="${path}"]`)
  }
}
