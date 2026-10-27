// A workspace's Files view in the review pane: the head's counts (`n · m changed`), the filter
// (and its `n matches · ⏎ opens` hint), Refresh and Open in editor in the pane's strip, and the
// tree. Rows are keyed by their index among the visible rows, with the path in data-path and
// `dir` or `file` in data-kind. The pane's icon is ReviewPage.viewFiles; a file's tab is
// FileViewPage, a diff's DiffPage.
import type { Locator, Page } from '@playwright/test'

export class FilesPage {
  page: Page
  root: Locator
  summary: Locator
  count: Locator
  error: Locator
  filter: Locator
  filterHint: Locator
  refresh: Locator
  openEditor: Locator
  // Every visible row, in tree order.
  rows: Locator
  row: (index: number) => Locator
  // A directory row's count of changed files beneath it.
  rowCount: (index: number) => Locator
  rowByPath: (path: string) => Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('files-tree')
    this.summary = page.getByTestId('files-summary')
    this.count = page.getByTestId('files-count')
    this.error = page.getByTestId('files-error')
    this.filter = page.getByTestId('files-filter')
    this.filterHint = page.getByTestId('files-filter-hint')
    this.refresh = page.getByTestId('files-refresh')
    this.openEditor = page.getByTestId('files-open-editor')
    this.rows = this.root.getByRole('treeitem')
    this.row = (index) => page.getByTestId(`files-row-${index}`)
    this.rowCount = (index) => page.getByTestId(`files-row-${index}-count`)
    this.rowByPath = (path) => page.locator(`[data-testid^="files-row-"][data-path="${path}"]`)
  }
}
