// The session's pull requests in the review pane: the list (rows keyed by the pull request's
// number, open and draft first, then merged and closed) and one pull request open in place (its
// title and meta line, then its files, checks and comments, each folding at its head). The
// pane's icon is ReviewPage.viewPrs and its back link ReviewPage.back; a file's diff tab is
// DiffPage.prTab.
import type { Locator, Page } from '@playwright/test'

export class PullRequestPage {
  page: Page
  list: Locator
  listSummary: Locator
  empty: Locator
  activeRows: Locator
  settledRows: Locator
  settledLabel: Locator
  row: (number: number) => Locator
  rowMeta: (number: number) => Locator
  rowComments: (number: number) => Locator
  root: Locator
  error: Locator
  title: Locator
  meta: Locator
  headerLink: Locator
  refresh: Locator
  filesHead: Locator
  filesSummary: Locator
  file: (index: number) => Locator
  checksHead: Locator
  checksSummary: Locator
  checksEmpty: Locator
  check: (index: number) => Locator
  checkLink: (index: number) => Locator
  checksPassing: Locator
  commentsHead: Locator
  commentsCount: Locator
  commentsEmpty: Locator
  comment: (index: number) => Locator
  commentPath: (index: number) => Locator
  commentHunk: (index: number) => Locator

  constructor(page: Page) {
    this.page = page
    this.list = page.getByTestId('pr-list')
    this.listSummary = page.getByTestId('pr-list-summary')
    this.empty = page.getByTestId('pr-empty')
    this.activeRows = page.getByTestId('pr-rows-active').locator('button[data-testid^="pr-row-"]')
    this.settledRows = page.getByTestId('pr-rows-settled').locator('button[data-testid^="pr-row-"]')
    this.settledLabel = page.getByTestId('pr-settled-label')
    this.row = (number) => page.getByTestId(`pr-row-${number}`)
    this.rowMeta = (number) => page.getByTestId(`pr-row-${number}-meta`)
    this.rowComments = (number) => page.getByTestId(`pr-row-${number}-comments`)
    this.root = page.getByTestId('pr-view')
    this.error = page.getByTestId('pr-error')
    this.title = page.getByTestId('pr-title')
    this.meta = page.getByTestId('pr-meta')
    this.headerLink = page.getByTestId('pr-header-link')
    this.refresh = page.getByTestId('pr-refresh')
    this.filesHead = page.getByTestId('pr-files-head')
    this.filesSummary = page.getByTestId('pr-files-summary')
    this.file = (index) => page.getByTestId(`pr-file-${index}`)
    this.checksHead = page.getByTestId('pr-checks-head')
    this.checksSummary = page.getByTestId('pr-checks-summary')
    this.checksEmpty = page.getByTestId('pr-checks-empty')
    this.check = (index) => page.getByTestId(`pr-check-${index}`)
    this.checkLink = (index) => page.getByTestId(`pr-check-${index}-link`)
    this.checksPassing = page.getByTestId('pr-checks-passing')
    this.commentsHead = page.getByTestId('pr-comments-head')
    this.commentsCount = page.getByTestId('pr-comments-count')
    this.commentsEmpty = page.getByTestId('pr-comments-empty')
    this.comment = (index) => page.getByTestId(`pr-comment-${index}`)
    this.commentPath = (index) => page.getByTestId(`pr-comment-${index}-path`)
    this.commentHunk = (index) => page.getByTestId(`pr-comment-${index}-hunk`)
  }
}
