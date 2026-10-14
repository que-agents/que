// The main window's chrome: the top bar, the app-level error banner, and the
// tray title (read through the QUE_E2E test hook; the menu bar is out of reach).
import type { Locator, Page } from '@playwright/test'

export class AppShellPage {
  page: Page
  topbar: Locator
  cwd: Locator
  error: Locator

  constructor(page: Page) {
    this.page = page
    this.topbar = page.getByTestId('topbar')
    this.cwd = page.getByTestId('topbar-cwd')
    this.error = page.getByTestId('app-error')
  }

  async waitForLoad() {
    await this.topbar.waitFor({ state: 'visible' })
  }

  async trayTitle(): Promise<string> {
    return this.page.evaluate(() => window.__que?.trayTitle() ?? Promise.resolve(''))
  }
}
