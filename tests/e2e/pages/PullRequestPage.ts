// A workspace's pull request in the review pane: the header, the checks, the
// conversation and the footer (Create draft PR without one). The pane's tab
// itself is ReviewPage.tabPr; its toggle is TopBarPage.reviewToggle.
import type { Locator, Page } from '@playwright/test'

export class PullRequestPage {
  page: Page
  root: Locator
  empty: Locator
  error: Locator
  headerLink: Locator
  review: Locator
  checks: Locator
  checksSummary: Locator
  checksEmpty: Locator
  check: (index: number) => Locator
  checkLink: (index: number) => Locator
  comments: Locator
  commentsEmpty: Locator
  comment: (index: number) => Locator
  commentHunk: (index: number) => Locator
  refresh: Locator
  footerLink: Locator
  create: Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('pr-view')
    this.empty = page.getByTestId('pr-empty')
    this.error = page.getByTestId('pr-error')
    this.headerLink = page.getByTestId('pr-header-link')
    this.review = page.getByTestId('pr-review')
    this.checks = page.getByTestId('pr-checks')
    this.checksSummary = page.getByTestId('pr-checks-summary')
    this.checksEmpty = page.getByTestId('pr-checks-empty')
    this.check = (index) => page.getByTestId(`pr-check-${index}`)
    this.checkLink = (index) => page.getByTestId(`pr-check-${index}-link`)
    this.comments = page.getByTestId('pr-comments')
    this.commentsEmpty = page.getByTestId('pr-comments-empty')
    this.comment = (index) => page.getByTestId(`pr-comment-${index}`)
    this.commentHunk = (index) => page.getByTestId(`pr-comment-${index}-hunk`)
    this.refresh = page.getByTestId('pr-refresh')
    this.footerLink = page.getByTestId('pr-footer-link')
    this.create = page.getByTestId('pr-create')
  }
}
