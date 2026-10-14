// The main window's chrome: the top bar and the app-level error banner.
import type { Locator, Page } from '@playwright/test'

export class AppShellPage {
  page: Page
  topbar: Locator
  cwd: Locator
  newTerminalButton: Locator
  openFolderButton: Locator
  error: Locator

  constructor(page: Page) {
    this.page = page
    this.topbar = page.getByTestId('topbar')
    this.cwd = page.getByTestId('topbar-cwd')
    this.newTerminalButton = page.getByTestId('topbar-new-terminal')
    this.openFolderButton = page.getByTestId('topbar-open-folder')
    this.error = page.getByTestId('app-error')
  }

  async waitForLoad() {
    await this.topbar.waitFor({ state: 'visible' })
  }
}
