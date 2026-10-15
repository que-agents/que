// The review pane at the right of the main area: its two tabs, its close
// button, the resizer on its left edge, and its state from the test hook.
import type { Locator, Page } from '@playwright/test'

export interface ReviewState {
  open: boolean
  tab: 'changes' | 'pr'
  width: number
}

export class ReviewPage {
  page: Page
  root: Locator
  tabChanges: Locator
  tabPr: Locator
  close: Locator
  resizer: Locator
  empty: Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('review-pane')
    this.tabChanges = page.getByTestId('review-tab-changes')
    this.tabPr = page.getByTestId('review-tab-pr')
    this.close = page.getByTestId('review-close')
    this.resizer = page.getByTestId('review-resizer')
    this.empty = page.getByTestId('review-empty')
  }

  // The pane as the renderer's test hook reports it.
  async state(): Promise<ReviewState> {
    return this.page.evaluate(
      () => window.__que?.review() ?? { open: false, tab: 'changes' as const, width: 0 }
    )
  }
}
