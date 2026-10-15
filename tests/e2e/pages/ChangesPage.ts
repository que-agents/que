// A workspace's Changes view: the top bar toggle, the summary, the file list and the patch.
import type { Locator, Page } from '@playwright/test'

export class ChangesPage {
  page: Page
  toggle: Locator
  root: Locator
  summary: Locator
  patch: Locator
  empty: Locator
  error: Locator
  refresh: Locator
  file: (index: number) => Locator

  constructor(page: Page) {
    this.page = page
    this.toggle = page.getByTestId('topbar-changes')
    this.root = page.getByTestId('changes-view')
    this.summary = page.getByTestId('changes-summary')
    this.patch = page.getByTestId('changes-patch')
    this.empty = page.getByTestId('changes-empty')
    this.error = page.getByTestId('changes-error')
    this.refresh = page.getByTestId('changes-refresh')
    this.file = (index) => page.getByTestId(`changes-file-${index}`)
  }
}
