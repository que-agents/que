// The quiet board window: the strip (header), the count line, the scrolling
// list of rows keyed by workspace id, and its controls: Unlock, and End
// quiet in a manual quiet.
import type { Locator, Page } from '@playwright/test'

export class QuietBoardPage {
  page: Page
  root: Locator
  header: Locator
  counts: Locator
  empty: Locator
  /** The list's scroll container; its rows are its `li`s, in the board's order. */
  rows: Locator
  unlockButton: Locator
  end: Locator
  row: (id: string) => Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('quiet-board')
    this.header = page.getByTestId('quiet-board-header')
    this.counts = page.getByTestId('quiet-board-counts')
    this.empty = page.getByTestId('quiet-board-empty')
    this.rows = page.getByTestId('quiet-board-rows')
    this.unlockButton = page.getByTestId('quiet-board-unlock')
    this.end = page.getByTestId('quiet-board-end')
    this.row = (id: string) => page.getByTestId(`quiet-board-row-${id}`)
  }

  async waitForLoad() {
    await this.root.waitFor({ state: 'visible' })
  }
}
