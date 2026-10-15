import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeTermInfo } from '@renderer/testing/fixtures'
import App from '../App'

const one = makeTermInfo({ name: 'one', cwd: '/Users/dev/a' })
const two = makeTermInfo({ name: 'two', cwd: '/Users/dev/b' })

const SPLIT_BESIDE = '{Meta>}d{/Meta}'
const SPLIT_BELOW = '{Meta>}{Shift>}d{/Shift}{/Meta}'

function seed(): void {
  fakeBridge.seedTerminal(one)
  fakeBridge.seedTerminal(two)
}

function tabsIn(pane: number): HTMLElement[] {
  return within(screen.getByTestId(`pane-${pane}`)).getAllByRole('tab')
}

/** Splits beside and waits for the second pane to hold its new terminal. */
async function splitBeside(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  await user.keyboard(SPLIT_BESIDE)
  const pane = await screen.findByTestId('pane-1')
  await waitFor(() => {
    expect(pane.dataset.activeTerm).not.toBe('')
  })
  return pane.dataset.activeTerm as string
}

describe('Panes', () => {
  describe('rendering', () => {
    it('shows one pane with every tab until it is split', async () => {
      seed()
      render(<App />)

      expect(await screen.findByTestId('pane-0')).toHaveAttribute('data-focused', 'true')
      expect(tabsIn(0)).toHaveLength(2)
      expect(screen.queryByTestId('pane-1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('pane-divider')).not.toBeInTheDocument()
    })
  })

  describe('splitting', () => {
    it('Cmd+D splits beside with a new focused terminal in the second pane', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)

      const created = await splitBeside(user)

      expect(created).not.toBe(two.id)
      expect(screen.getByTestId('pane-1')).toHaveAttribute('data-focused', 'true')
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'false')
      expect(tabsIn(0)).toHaveLength(2)
      expect(tabsIn(1)).toHaveLength(1)
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-active-term', two.id)
      expect(screen.getByTestId('pane-divider')).toHaveAttribute('aria-orientation', 'vertical')
      expect(await window.que.term.list()).toHaveLength(3)
    })

    it('Cmd+Shift+D splits below', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)

      await user.keyboard(SPLIT_BELOW)

      expect(await screen.findByTestId('pane-1')).toBeInTheDocument()
      expect(screen.getByTestId('pane-divider')).toHaveAttribute('aria-orientation', 'horizontal')
    })

    it('the top bar buttons split, and join the panes without killing anything', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)

      await user.click(screen.getByRole('button', { name: 'Split beside' }))
      await screen.findByTestId('pane-1')
      expect(screen.queryByRole('button', { name: 'Split beside' })).not.toBeInTheDocument()
      const before = await window.que.term.list()

      await user.click(screen.getByRole('button', { name: 'Join panes' }))

      await waitFor(() => {
        expect(screen.queryByTestId('pane-1')).not.toBeInTheDocument()
      })
      expect(tabsIn(0)).toHaveLength(3)
      expect(await window.que.term.list()).toHaveLength(before.length)
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')

      await user.click(screen.getByRole('button', { name: 'Split below' }))
      expect(await screen.findByTestId('pane-divider')).toHaveAttribute(
        'aria-orientation',
        'horizontal'
      )
    })
  })

  describe('focus and tabs', () => {
    it('Cmd+T opens in the focused pane; clicking a tab in the other pane focuses it', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)

      await user.keyboard('{Meta>}t{/Meta}')
      await waitFor(() => {
        expect(tabsIn(1)).toHaveLength(2)
      })
      expect(tabsIn(0)).toHaveLength(2)

      await user.click(screen.getByTestId(`terminal-tab-${one.id}-select`))

      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-active-term', one.id)
      expect(screen.getByTestId(`terminal-tab-${one.id}-select`)).toHaveAttribute(
        'aria-selected',
        'true'
      )

      await user.keyboard('{Meta>}t{/Meta}')
      await waitFor(() => {
        expect(tabsIn(0)).toHaveLength(3)
      })
      expect(tabsIn(1)).toHaveLength(2)
    })

    it('the + of a pane opens a terminal there and focuses it', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)

      await user.click(screen.getByTestId('pane-0-new'))

      await waitFor(() => {
        expect(tabsIn(0)).toHaveLength(3)
      })
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')
    })

    it('Cmd+Option+arrows move focus between the panes', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)

      await user.keyboard('{Meta>}{Alt>}{ArrowLeft}{/Alt}{/Meta}')
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')

      await user.keyboard('{Meta>}{Alt>}{ArrowRight}{/Alt}{/Meta}')
      expect(screen.getByTestId('pane-1')).toHaveAttribute('data-focused', 'true')

      await user.keyboard('{Meta>}{Alt>}{ArrowUp}{/Alt}{/Meta}')
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')
    })

    it("the top bar's folder follows the focused pane", async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)
      await user.click(screen.getByTestId(`terminal-tab-${one.id}-select`))
      expect(screen.getByTestId('topbar-cwd')).toHaveTextContent('/Users/dev/a')

      await user.keyboard('{Meta>}{Alt>}{ArrowRight}{/Alt}{/Meta}')

      // The new terminal started in the folder that was active when it was split.
      expect(screen.getByTestId('topbar-cwd')).toHaveTextContent('/Users/dev/b')
    })
  })

  describe('closing', () => {
    it('Cmd+W closes the focused pane active tab', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)
      await user.click(screen.getByTestId(`terminal-tab-${one.id}-select`))

      await user.keyboard('{Meta>}w{/Meta}')

      await waitFor(() => {
        expect(fakeBridge.getTerminal(one.id)).toBeUndefined()
      })
      expect(tabsIn(0)).toHaveLength(1)
      expect(tabsIn(1)).toHaveLength(1)
    })

    it("closing the second pane's last tab collapses the split and refocuses the first", async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)

      await user.keyboard('{Meta>}w{/Meta}')

      await waitFor(() => {
        expect(screen.queryByTestId('pane-1')).not.toBeInTheDocument()
      })
      expect(screen.queryByTestId('pane-divider')).not.toBeInTheDocument()
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')
      expect(tabsIn(0)).toHaveLength(2)
    })

    it("closing the first pane's last tab moves the second pane's tabs over", async () => {
      const user = userEvent.setup()
      fakeBridge.seedTerminal(one)
      render(<App />)
      await screen.findByTestId(`terminal-tab-${one.id}`)
      const created = await splitBeside(user)

      await user.click(screen.getByRole('button', { name: 'Close one' }))

      await waitFor(() => {
        expect(screen.queryByTestId('pane-1')).not.toBeInTheDocument()
      })
      expect(tabsIn(0)).toHaveLength(1)
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-active-term', created)
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')
    })
  })

  describe('the divider', () => {
    it('moves with the arrow keys, clamps, and resets on double-click', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)
      const panes = screen.getByTestId('panes')
      const divider = screen.getByTestId('pane-divider')
      expect(panes).toHaveAttribute('data-ratio', '0.5')

      divider.focus()
      await user.keyboard('{ArrowRight}')
      expect(panes).toHaveAttribute('data-ratio', '0.55')
      expect(panes.style.gridTemplateColumns).toBe('0.55fr 7px 0.45fr')
      await user.keyboard('{ArrowLeft}{ArrowLeft}')
      expect(panes).toHaveAttribute('data-ratio', '0.45')

      await user.keyboard('{Home}')
      expect(panes).toHaveAttribute('data-ratio', '0.2')
      await user.keyboard('{ArrowLeft}')
      expect(panes).toHaveAttribute('data-ratio', '0.2')

      await user.dblClick(divider)
      expect(panes).toHaveAttribute('data-ratio', '0.5')
    })

    it('uses rows for a split below, moved by the up and down arrows', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await user.keyboard(SPLIT_BELOW)
      const divider = await screen.findByTestId('pane-divider')

      divider.focus()
      await user.keyboard('{ArrowDown}')

      expect(screen.getByTestId('panes').style.gridTemplateRows).toBe('0.55fr 7px 0.45fr')
    })
  })

  describe('remembering', () => {
    it('restores the split and both panes after the app reloads', async () => {
      const user = userEvent.setup()
      seed()
      const first = render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      const created = await splitBeside(user)
      screen.getByTestId('pane-divider').focus()
      await user.keyboard('{ArrowRight}')
      first.unmount()

      render(<App />)

      expect(await screen.findByTestId('pane-1')).toHaveAttribute('data-active-term', created)
      expect(tabsIn(0)).toHaveLength(2)
      expect(tabsIn(1)).toHaveLength(1)
      expect(screen.getByTestId('pane-divider')).toHaveAttribute('aria-orientation', 'vertical')
      expect(await window.que.term.list()).toHaveLength(3)
    })

    it('drops a remembered terminal that no longer exists', async () => {
      seed()
      localStorage.setItem(
        'que.layout.',
        JSON.stringify({
          split: { direction: 'row', ratio: 0.5 },
          second: [one.id, 'gone-terminal'],
          active: [null, 'gone-terminal'],
          focused: 1
        })
      )

      render(<App />)

      expect(await screen.findByTestId('pane-1')).toBeInTheDocument()
      expect(tabsIn(0)).toHaveLength(1)
      expect(tabsIn(1)).toHaveLength(1)
      expect(screen.getByTestId('pane-1')).toHaveAttribute('data-active-term', one.id)
    })

    it('collapses a remembered split whose second pane is gone', async () => {
      seed()
      localStorage.setItem(
        'que.layout.',
        JSON.stringify({
          split: { direction: 'row', ratio: 0.5 },
          second: ['gone-terminal'],
          active: [null, null],
          focused: 1
        })
      )

      render(<App />)

      await screen.findByTestId('pane-0')
      expect(screen.queryByTestId('pane-1')).not.toBeInTheDocument()
      expect(tabsIn(0)).toHaveLength(2)
    })
  })
})
