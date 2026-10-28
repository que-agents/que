// A file's diff tab in a pane's tab strip, beside the session tabs, and the
// diff it shows: a toolbar (the path, its counts, Unified | Split, Whitespace) over
// numbered, syntax-coloured lines. Tabs are keyed by the file's path (the diff has
// no other id); a pull request's own diff of a file is keyed by its number too
// (`prTab`), and its toolbar says what it is against (`#8 vs #7`).
import type { Locator, Page } from '@playwright/test'

export class DiffPage {
  page: Page
  root: Locator
  header: Locator
  additions: Locator
  deletions: Locator
  modeUnified: Locator
  modeSplit: Locator
  whitespace: Locator
  patch: Locator
  // Each drawn line's number in the new file (blank on a removed line), in order.
  lineNumbers: Locator
  // A token of the code with exactly this text, wherever it is drawn.
  token: (text: string) => Locator
  empty: Locator
  // Instead of lines: a binary file, one over the size cap, or no lines left to show.
  binary: Locator
  tooLarge: Locator
  noLines: Locator
  error: Locator
  against: Locator
  tab: (path: string) => Locator
  tabSelect: (path: string) => Locator
  tabClose: (path: string) => Locator
  prTab: (number: number, path: string) => Locator
  prTabClose: (number: number, path: string) => Locator
  // The patch line a line comment asked for.
  target: Locator
  // The Comments ▾ button (only when the file has comment lines) and the comment counts.
  commentsButton: Locator
  commentCounts: Locator
  // The drawn lines that are dimmed changed comment lines.
  commentLines: Locator
  // Every diff tab, in any pane.
  tabs: Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('diff-view')
    this.header = page.getByTestId('diff-header')
    this.additions = page.getByTestId('diff-additions')
    this.deletions = page.getByTestId('diff-deletions')
    this.modeUnified = page.getByTestId('diff-mode-unified')
    this.modeSplit = page.getByTestId('diff-mode-split')
    this.whitespace = page.getByTestId('diff-whitespace')
    this.patch = page.getByTestId('diff-patch')
    this.lineNumbers = this.patch.getByTestId('diff-line-new')
    this.token = (text) =>
      this.patch.getByTestId('diff-line-code').locator('span').getByText(text, { exact: true })
    this.empty = page.getByTestId('diff-empty')
    this.binary = page.getByTestId('diff-binary')
    this.tooLarge = page.getByTestId('diff-too-large')
    this.noLines = page.getByTestId('diff-no-lines')
    this.error = page.getByTestId('diff-error')
    this.against = page.getByTestId('diff-against')
    this.target = this.patch.locator('[data-target]')
    this.commentsButton = page.getByTestId('diff-comments-button')
    this.commentCounts = page.getByTestId('diff-comment-counts')
    this.commentLines = this.patch.locator('[data-testid="diff-line"][data-comment]')
    this.tabs = page.getByTestId('view-tab-diff')
    this.tab = (path) =>
      page.locator(`[data-testid="view-tab-diff"][data-path="${path}"]:not([data-pr])`)
    this.prTab = (number, path) =>
      page.locator(`[data-testid="view-tab-diff"][data-path="${path}"][data-pr="${number}"]`)
    this.prTabClose = (number, path) =>
      page.locator(`[data-testid="view-tab-diff-close"][data-path="${path}"][data-pr="${number}"]`)
    this.tabSelect = (path) =>
      page.locator(`[data-testid="view-tab-diff-select"][data-path="${path}"]:not([data-pr])`)
    this.tabClose = (path) =>
      page.locator(`[data-testid="view-tab-diff-close"][data-path="${path}"]:not([data-pr])`)
  }
}
