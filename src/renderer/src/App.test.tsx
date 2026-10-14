import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
      expect(screen.getByTestId('topbar-cwd')).toHaveTextContent('/Users/dev/code/api')
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

  describe('status updates', () => {
    it('marks a tab exited when its process exits', async () => {
      fakeBridge.seedTerminal(uploader)
      render(<App />)
      const tab = await screen.findByTestId(`terminal-tab-${uploader.id}`)

      fakeBridge.exitTerminal(uploader.id, 0)

      expect(await within(tab).findByText('exited')).toBeInTheDocument()
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
      const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'ha-1432-retry-logic' })
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(retry)
      render(<App />)
      await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
      expect(await screen.findByRole('button', { name: 'Create draft PR' })).toBeEnabled()

      fakeBridge.disconnect()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Create draft PR' })).toBeDisabled()
      })
      for (const name of ['Open in editor', 'Hand off…', 'New terminal', 'Add project', 'Run']) {
        expect(screen.getByRole('button', { name })).toBeDisabled()
      }
      expect(screen.getByRole('button', { name: 'New workspace in uploader' })).toBeDisabled()
      expect(screen.getByRole('button', { name: '+ Task' })).toBeDisabled()
    })
  })
})
