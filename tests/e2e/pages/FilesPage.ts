// A workspace's Files tab in the review pane: the summary line (`Files n · m changed`),
// Refresh, Open in editor, and the tree. Rows are keyed by their index among the
// visible rows, with the path in data-path and `dir` or `file` in data-kind. The
// pane's tab is ReviewPage.tabFiles; a file's tab is FileViewPage, a diff's DiffPage.
import type { Locator, Page } from '@playwright/test'

export class FilesPage {
  page: Page
  root: Locator
  summary: Locator
  count: Locator
  error: Locator
  refresh: Locator
  openEditor: Locator
  // Every visible row, in tree order.
  rows: Locator
  row: (index: number) => Locator
  rowByPath: (path: string) => Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('files-tree')
    this.summary = page.getByTestId('files-summary')
    this.count = page.getByTestId('files-count')
    this.error = page.getByTestId('files-error')
    this.refresh = page.getByTestId('files-refresh')
    this.openEditor = page.getByTestId('files-open-editor')
    this.rows = this.root.getByRole('treeitem')
    this.row = (index) => page.getByTestId(`files-row-${index}`)
    this.rowByPath = (path) => page.locator(`[data-testid^="files-row-"][data-path="${path}"]`)
  }
}
