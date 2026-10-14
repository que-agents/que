// The quiet board window: header, counts, rows keyed by task or workspace id,
// and its one control, Unlock.
import type { Locator, Page } from '@playwright/test'

export class QuietBoardPage {
  page: Page
  root: Locator
  header: Locator
  counts: Locator
  empty: Locator
  unlockButton: Locator
  row: (id: string) => Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('quiet-board')
    this.header = page.getByTestId('quiet-board-header')
    this.counts = page.getByTestId('quiet-board-counts')
    this.empty = page.getByTestId('quiet-board-empty')
    this.unlockButton = page.getByTestId('quiet-board-unlock')
    this.row = (id: string) => page.getByTestId(`quiet-board-row-${id}`)
  }

  async waitForLoad() {
    await this.root.waitFor({ state: 'visible' })
  }
}
