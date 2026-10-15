// The main window's chrome: the app shell (the whole window), the top bar, the app-level error banner, and the
// tray title and the chimes played (read through the QUE_E2E test hook; the menu
// bar is out of reach, and under e2e the chimes are recorded, never heard).
import type { Locator, Page } from '@playwright/test'
import type { ChimeKind } from '../../../src/preload/index.d'

export class AppShellPage {
  page: Page
  root: Locator
  topbar: Locator
  cwd: Locator
  error: Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('app-shell')
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

  async chimes(): Promise<ChimeKind[]> {
    return this.page.evaluate(() => window.__que?.chimes() ?? [])
  }
}
