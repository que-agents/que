// The main window's chrome: the app shell (the whole window), the panes under the tab row, the
// app-level error banner, the reconnecting line and the stale-build banner, and the tray title and the chimes played (read through the QUE_E2E
// test hook; the menu bar is out of reach, and under e2e the chimes are recorded, never heard).
import type { Locator, Page } from '@playwright/test'
import type { ChimeKind } from '../../../src/preload/index.d'

export class AppShellPage {
  page: Page
  root: Locator
  panes: Locator
  error: Locator
  reconnecting: Locator
  daemonBanner: Locator

  constructor(page: Page) {
    this.page = page
    this.root = page.getByTestId('app-shell')
    this.panes = page.getByTestId('panes')
    this.error = page.getByTestId('app-error')
    this.reconnecting = page.getByTestId('app-reconnecting')
    this.daemonBanner = page.getByTestId('app-daemon-banner')
  }

  async waitForLoad() {
    await this.panes.waitFor({ state: 'visible' })
  }

  async trayTitle(): Promise<string> {
    return this.page.evaluate(() => window.__que?.trayTitle() ?? Promise.resolve(''))
  }

  async chimes(): Promise<ChimeKind[]> {
    return this.page.evaluate(() => window.__que?.chimes() ?? [])
  }
}
