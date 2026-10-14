// Terminal tabs and the xterm viewport. Content is read through the renderer's
// QUE_E2E test hook (window.__que), never from the DOM.
import { expect, type Locator, type Page } from '@playwright/test'

export class TerminalPage {
  page: Page
  viewport: Locator
  input: Locator
  emptyState: Locator
  tab: (id: string) => Locator
  tabSelect: (id: string) => Locator
  tabClose: (id: string) => Locator
  tabExited: (id: string) => Locator
  tabReattached: (id: string) => Locator

  constructor(page: Page) {
    this.page = page
    this.viewport = page.getByTestId('terminal-viewport')
    // xterm renders this textarea; it is the one accepted CSS selector.
    this.input = page.getByTestId('terminal-viewport').locator('.xterm-helper-textarea')
    this.emptyState = page.getByTestId('terminal-empty')
    this.tab = (id: string) => page.getByTestId(`terminal-tab-${id}`)
    this.tabSelect = (id: string) => page.getByTestId(`terminal-tab-${id}-select`)
    this.tabClose = (id: string) => page.getByTestId(`terminal-tab-${id}-close`)
    this.tabExited = (id: string) => page.getByTestId(`terminal-tab-${id}-exited`)
    this.tabReattached = (id: string) => page.getByTestId(`terminal-tab-${id}-reattached`)
  }

  async activeTermId(): Promise<string | null> {
    return this.page.evaluate(() => window.__que?.activeTermId() ?? null)
  }

  async screenText(): Promise<string> {
    return this.page.evaluate(() => window.__que?.screenText() ?? '')
  }

  // Waits until a terminal is attached and on screen, and returns its id.
  async waitForActiveTerminal(timeout = 20_000): Promise<string> {
    await this.viewport.waitFor({ state: 'visible', timeout })
    await expect
      .poll(() => this.activeTermId(), { message: 'no terminal attached', timeout })
      .not.toBeNull()
    return (await this.activeTermId()) as string
  }

  // Polls the xterm buffer until a whole line matches, with the screen in the failure message.
  async expectScreenToContain(text: string, timeout = 15_000) {
    await expect
      .poll(
        async () => (await this.screenText()).split('\n').some((line) => line.trim() === text),
        {
          message: `no screen line "${text}"`,
          timeout
        }
      )
      .toBe(true)
  }
}
