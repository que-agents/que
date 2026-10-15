// Terminal tabs and the xterm viewport. Content is read through the renderer's
// QUE_E2E test hook (window.__que), never from the DOM.
import { expect, type Locator, type Page } from '@playwright/test'

export interface PaneState {
  index: number
  activeTermId: string | null
  focused: boolean
}

export class TerminalPage {
  page: Page
  // Within the first pane; use pane(n) for another.
  viewport: Locator
  input: Locator
  divider: Locator
  emptyState: Locator
  tab: (id: string) => Locator
  tabSelect: (id: string) => Locator
  tabClose: (id: string) => Locator
  tabExited: (id: string) => Locator
  tabReattached: (id: string) => Locator

  constructor(page: Page) {
    this.page = page
    const first = this.pane(0)
    this.viewport = first.viewport
    this.input = first.input
    this.divider = page.getByTestId('pane-divider')
    this.emptyState = page.getByTestId('terminal-empty')
    this.tab = (id: string) => page.getByTestId(`terminal-tab-${id}`)
    this.tabSelect = (id: string) => page.getByTestId(`terminal-tab-${id}-select`)
    this.tabClose = (id: string) => page.getByTestId(`terminal-tab-${id}-close`)
    this.tabExited = (id: string) => page.getByTestId(`terminal-tab-${id}-exited`)
    this.tabReattached = (id: string) => page.getByTestId(`terminal-tab-${id}-reattached`)
  }

  // One pane: its container, terminal viewport, xterm input and + button.
  pane(n: number): { root: Locator; viewport: Locator; input: Locator; newButton: Locator } {
    const root = this.page.getByTestId(`pane-${n}`)
    const viewport = root.getByTestId('terminal-viewport')
    return {
      root,
      viewport,
      // xterm renders this textarea; it is the one accepted CSS selector.
      input: viewport.locator('.xterm-helper-textarea'),
      newButton: this.page.getByTestId(`pane-${n}-new`)
    }
  }

  // The panes on screen, as the renderer's test hook reports them.
  async panes(): Promise<PaneState[]> {
    return this.page.evaluate(() => window.__que?.panes() ?? [])
  }

  // Polls one pane's active terminal until a whole line matches.
  async expectPaneScreenToContain(n: number, text: string, timeout = 15_000) {
    await expect
      .poll(
        async () => {
          const id = (await this.panes()).find((p) => p.index === n)?.activeTermId
          if (!id) return false
          const screen = await this.page.evaluate((t) => window.__que?.screenTextOf(t) ?? '', id)
          return screen.split('\n').some((line) => line.trim() === text)
        },
        { message: `no screen line "${text}" in pane ${n}`, timeout }
      )
      .toBe(true)
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
