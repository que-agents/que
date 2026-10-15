// A workspace's Changes list in the review pane: the summary line (its commit
// count and base, each opening a menu: the commits to narrow to, keyed by sha,
// and the refs to compare against, by index with the ref in data-ref),
// Refresh, Open in editor, and the file rows. The pane's toggle is TopBarPage.reviewToggle; a
// file's diff tab is DiffPage.
import type { Locator, Page } from '@playwright/test'

export class ChangesPage {
  page: Page
  root: Locator
  summary: Locator
  commits: Locator
  base: Locator
  files: Locator
  empty: Locator
  error: Locator
  refresh: Locator
  openEditor: Locator
  file: (index: number) => Locator
  commitsMenu: Locator
  commitAll: Locator
  commit: (sha: string) => Locator
  // The open Commits menu's items in order: All commits, then the commits newest first.
  commitItems: Locator
  baseMenu: Locator
  baseOption: (index: number) => Locator
  // The open base menu's items in order, and the one for a ref.
  baseOptions: Locator
  baseRef: (ref: string) => Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('changes-list')
    this.summary = page.getByTestId('changes-summary')
    this.commits = page.getByTestId('changes-commits')
    this.base = page.getByTestId('changes-base')
    this.commitsMenu = page.getByTestId('changes-commits-menu')
    this.commitAll = page.getByTestId('changes-commit-all')
    this.commit = (sha) => page.getByTestId(`changes-commit-${sha}`)
    this.commitItems = page.getByRole('menu', { name: 'Commits' }).getByRole('menuitemradio')
    this.baseMenu = page.getByTestId('changes-base-menu')
    this.baseOption = (index) => page.getByTestId(`changes-base-option-${index}`)
    this.baseOptions = page
      .getByRole('menu', { name: 'Compare against' })
      .getByRole('menuitemradio')
    this.baseRef = (ref) => page.locator(`[data-testid^="changes-base-option-"][data-ref="${ref}"]`)
    this.files = page.getByTestId('changes-files')
    this.empty = page.getByTestId('changes-empty')
    this.error = page.getByTestId('changes-error')
    this.refresh = page.getByTestId('changes-refresh')
    this.openEditor = page.getByTestId('changes-open-editor')
    this.file = (index) => page.getByTestId(`changes-file-${index}`)
  }
}
