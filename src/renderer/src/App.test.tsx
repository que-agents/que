import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject, makeTermInfo, makeWorkspace } from '@renderer/testing/fixtures'
import App from './App'

const uploader = makeTermInfo({ name: 'zsh', cwd: '/Users/dev/code/uploader' })
const api = makeTermInfo({ name: 'node', cwd: '/Users/dev/code/api' })

describe('App', () => {
  describe('rendering', () => {
    it('reattaches to the terminals already running in the daemon', async () => {
      fakeBridge.seedTerminal(uploader)
      fakeBridge.seedTerminal(api)

      render(<App />)

      expect(await screen.findByTestId(`terminal-tab-${api.id}`)).toBeInTheDocument()
      expect(screen.getByTestId(`terminal-tab-${uploader.id}-reattached`)).toBeInTheDocument()
      expect(screen.getByTestId(`terminal-tab-${api.id}-reattached`)).toBeInTheDocument()
      expect(screen.getByTestId(`terminal-tab-${api.id}-select`)).toHaveAttribute(
        'aria-selected',
        'true'
      )
    })

    it('opens one terminal in the home directory on a fresh launch', async () => {
      render(<App />)

      expect(await screen.findByRole('tab')).toBeInTheDocument()
      const terms = await window.que.term.list()
      expect(terms).toHaveLength(1)
      expect(terms[0].cwd).toBe('/Users/dev')
      expect(screen.queryByText('reattached')).not.toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('kills the terminal when its tab is closed', async () => {
      const user = userEvent.setup()
      fakeBridge.seedTerminal(uploader)
      render(<App />)

      await user.click(await screen.findByRole('button', { name: 'Close zsh' }))

      await waitFor(() => {
        expect(fakeBridge.getTerminal(uploader.id)).toBeUndefined()
      })
      expect(screen.queryByTestId(`terminal-tab-${uploader.id}`)).not.toBeInTheDocument()
      expect(screen.getByTestId('terminal-empty')).toBeInTheDocument()
    })

    it("opens a new terminal in the active terminal's directory", async () => {
      const user = userEvent.setup()
      fakeBridge.seedTerminal(api)
      render(<App />)
      await screen.findByTestId(`terminal-tab-${api.id}`)

      await user.click(screen.getByRole('button', { name: 'New terminal' }))

      await waitFor(() => {
        expect(screen.getAllByRole('tab')).toHaveLength(2)
      })
      const created = (await window.que.term.list()).find((t) => t.id !== api.id)
      expect(created?.cwd).toBe('/Users/dev/code/api')
    })
  })

  describe('keyboard', () => {
    it('opens a tab with Cmd+T and closes the active one with Cmd+W', async () => {
      const user = userEvent.setup()
      fakeBridge.seedTerminal(uploader)
      render(<App />)
      await screen.findByTestId(`terminal-tab-${uploader.id}`)

      await user.keyboard('{Meta>}t{/Meta}')

      await waitFor(() => {
        expect(screen.getAllByRole('tab')).toHaveLength(2)
      })
      const created = (await window.que.term.list()).find((t) => t.id !== uploader.id)
      expect(screen.getByTestId(`terminal-tab-${created?.id}-select`)).toHaveAttribute(
        'aria-selected',
        'true'
      )

      await user.keyboard('{Meta>}w{/Meta}')

      await waitFor(() => {
        expect(fakeBridge.getTerminal(created?.id ?? '')).toBeUndefined()
      })
      expect(screen.getAllByRole('tab')).toHaveLength(1)
    })
  })

  describe('review shortcut', () => {
    it('toggles the review pane with Cmd+B, on the tab it was left on', async () => {
      const user = userEvent.setup()
      const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(retry)
      render(<App />)
      await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
      const toggle = await screen.findByRole('button', { name: 'Review pane' })

      await user.keyboard('{Meta>}b{/Meta}')

      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'changes')
      expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await user.click(screen.getByRole('tab', { name: 'Pull request' }))

      await user.keyboard('{Meta>}b{/Meta}')

      expect(screen.queryByTestId('review-pane')).not.toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-pressed', 'false')

      await user.keyboard('{Meta>}b{/Meta}')

      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'pr')
    })

    it('leaves Cmd+B alone while a dialog is open', async () => {
      const user = userEvent.setup()
      const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(retry)
      render(<App />)
      await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
      await user.click(await screen.findByRole('button', { name: 'Review pane' }))
      await user.click(screen.getByRole('tab', { name: 'Pull request' }))
      await user.click(await screen.findByRole('button', { name: 'Create draft PR' }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      await user.keyboard('{Meta>}b{/Meta}')

      expect(screen.getByTestId('review-pane')).toBeInTheDocument()
    })
  })

  describe('search shortcut', () => {
    it('opens the sidebar search with Cmd+K, focused', async () => {
      const user = userEvent.setup()
      fakeBridge.seedTerminal(uploader)
      render(<App />)
      await screen.findByTestId('sidebar-search-toggle')
      expect(screen.queryByTestId('sidebar-search')).not.toBeInTheDocument()

      await user.keyboard('{Meta>}k{/Meta}')

      expect(await screen.findByTestId('sidebar-search')).toHaveFocus()
    })

    it('focuses and selects the text again when Cmd+K is pressed while open', async () => {
      const user = userEvent.setup()
      fakeBridge.seedTerminal(uploader)
      render(<App />)
      await user.click(await screen.findByTestId('sidebar-search-toggle'))
      const field = (await screen.findByTestId('sidebar-search')) as HTMLInputElement
      await user.type(field, 'abc')
      field.blur()
      expect(field).not.toHaveFocus()

      await user.keyboard('{Meta>}k{/Meta}')

      expect(field).toHaveFocus()
      expect(field.selectionStart).toBe(0)
      expect(field.selectionEnd).toBe(3)
    })

    it('leaves Cmd+K alone while a dialog is open', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      render(<App />)
      await user.click(await screen.findByRole('button', { name: /^New workspace in/ }))
      await screen.findByRole('dialog')

      await user.keyboard('{Meta>}k{/Meta}')

      expect(screen.queryByTestId('sidebar-search')).not.toBeInTheDocument()
    })
  })

  describe('errors', () => {
    it('tells the user when the daemon connection drops', async () => {
      fakeBridge.seedTerminal(uploader)
      render(<App />)
      await screen.findByTestId(`terminal-tab-${uploader.id}`)

      fakeBridge.disconnect()

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Lost connection to the que daemon.'
      )
    })

    it('disables every daemon action while disconnected', async () => {
      const user = userEvent.setup()
      const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(retry)
      render(<App />)
      await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
      await user.click(await screen.findByRole('button', { name: 'Review pane' }))
      expect(await screen.findByRole('button', { name: 'Open in editor' })).toBeEnabled()

      fakeBridge.disconnect()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Open in editor' })).toBeDisabled()
      })

      for (const name of [
        'Review pane',
        'Refresh',
        'New terminal',
        'Split beside',
        'Split below',
        'Add project',
        'New session'
      ]) {
        expect(screen.getByRole('button', { name })).toBeDisabled()
      }

      expect(screen.getByRole('button', { name: 'New workspace in uploader' })).toBeDisabled()

      await user.click(screen.getByRole('tab', { name: 'Pull request' }))

      expect(await screen.findByRole('button', { name: 'Create draft PR' })).toBeDisabled()
    })
  })
})
