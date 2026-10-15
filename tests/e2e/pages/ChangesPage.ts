// A workspace's Changes list in the review pane: the summary, Refresh, Open in
// editor, and the file rows. The pane's toggle is TopBarPage.reviewToggle; a
// file's diff tab is DiffPage.
import type { Locator, Page } from '@playwright/test'

export class ChangesPage {
  page: Page
  root: Locator
  summary: Locator
  files: Locator
  empty: Locator
  error: Locator
  refresh: Locator
  openEditor: Locator
  file: (index: number) => Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('changes-list')
    this.summary = page.getByTestId('changes-summary')
    this.files = page.getByTestId('changes-files')
    this.empty = page.getByTestId('changes-empty')
    this.error = page.getByTestId('changes-error')
    this.refresh = page.getByTestId('changes-refresh')
    this.openEditor = page.getByTestId('changes-open-editor')
    this.file = (index) => page.getByTestId(`changes-file-${index}`)
  }
}
