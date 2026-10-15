// A workspace's Changes list in the review pane: the top bar button that opens
// the pane on it, the summary, Refresh, and the file rows. A file's diff tab is DiffPage.
import type { Locator, Page } from '@playwright/test'

export class ChangesPage {
  page: Page
  toggle: Locator
  root: Locator
  summary: Locator
  files: Locator
  empty: Locator
  error: Locator
  refresh: Locator
  file: (index: number) => Locator

  constructor(page: Page) {
    this.page = page
    this.toggle = page.getByTestId('topbar-changes')
    this.root = page.getByTestId('changes-list')
    this.summary = page.getByTestId('changes-summary')
    this.files = page.getByTestId('changes-files')
    this.empty = page.getByTestId('changes-empty')
    this.error = page.getByTestId('changes-error')
    this.refresh = page.getByTestId('changes-refresh')
    this.file = (index) => page.getByTestId(`changes-file-${index}`)
  }
}
