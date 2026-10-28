// The review pane, a full-height column at the right of the window: its 40px strip (three view
// icons with their counts, or a pull request's back link; the view's own buttons at its right
// end, then the hide chevron), the resizer on its left edge, and its state from the test hook.
// Folded, it is a 40px rail: the show chevron at its top, the view icons stacked under it.
import type { Locator, Page } from '@playwright/test'

export interface ReviewState {
  open: boolean
  view: 'prs' | 'changes' | 'files'
  pr: number | null
  width: number
}

export class ReviewPage {
  page: Page
  root: Locator
  bar: Locator
  viewPrs: Locator
  viewChanges: Locator
  viewFiles: Locator
  // The counts beside the icons: open and draft pull requests, changed files.
  prsCount: Locator
  changesCount: Locator
  // `‹ #n` while a pull request is open in place.
  back: Locator
  resizer: Locator
  empty: Locator
  hide: Locator
  rail: Locator
  show: Locator
  railPrs: Locator
  railChanges: Locator
  railFiles: Locator
  railChangesCount: Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('review-pane')
    this.bar = page.getByTestId('review-bar')
    this.viewPrs = page.getByTestId('review-view-prs')
    this.viewChanges = page.getByTestId('review-view-changes')
    this.viewFiles = page.getByTestId('review-view-files')
    this.prsCount = page.getByTestId('review-view-prs-count')
    this.changesCount = page.getByTestId('review-view-changes-count')
    this.back = page.getByTestId('review-back')
    this.resizer = page.getByTestId('review-resizer')
    this.empty = page.getByTestId('review-empty')
    this.hide = page.getByTestId('review-hide')
    this.rail = page.getByTestId('review-rail')
    this.show = page.getByTestId('review-show')
    this.railPrs = page.getByTestId('review-rail-prs')
    this.railChanges = page.getByTestId('review-rail-changes')
    this.railFiles = page.getByTestId('review-rail-files')
    this.railChangesCount = page.getByTestId('review-rail-changes-count')
  }

  // The pane as the renderer's test hook reports it.
  async state(): Promise<ReviewState> {
    return this.page.evaluate(
      () => window.__que?.review() ?? { open: false, view: 'changes' as const, pr: null, width: 0 }
    )
  }
}
