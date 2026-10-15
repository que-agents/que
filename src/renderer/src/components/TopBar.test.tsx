import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject, makeWorkspace } from '@renderer/testing/fixtures'
import App from '../App'

const ID = 'ws_01hzx3k9c2qf'

/** Seeds one workspace, renders the app, and opens the workspace. */
async function openWorkspace(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(makeWorkspace({ id: ID, name: 'app-1432-retry-logic' }))
  render(<App />)
  await user.click(await screen.findByTestId(`sidebar-workspace-${ID}-open`))
  await screen.findByTestId('topbar-review')
}

describe('TopBar', () => {
  describe('the review toggle', () => {
    it('opens the review pane and closes it again, pressed while it is open', async () => {
      const user = userEvent.setup()
      await openWorkspace(user)
      const toggle = screen.getByRole('button', { name: 'Review pane' })
      expect(toggle).toHaveAttribute('data-testid', 'topbar-review')
      expect(toggle).toHaveAttribute('title', 'Review pane: changes and pull request (⌘B)')
      expect(toggle).toHaveAttribute('aria-pressed', 'false')

      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'changes')

      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByTestId('review-pane')).not.toBeInTheDocument()
    })

    it('opens on the tab the pane was last left on', async () => {
      const user = userEvent.setup()
      localStorage.setItem('que.review', JSON.stringify({ open: false, tab: 'pr', width: 320 }))
      await openWorkspace(user)

      await user.click(screen.getByRole('button', { name: 'Review pane' }))

      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'pr')
      expect(screen.getByTestId('review-tab-pr')).toHaveAttribute('aria-selected', 'true')
    })

    it('stays pressed while switching tabs and unpresses when the pane closes itself', async () => {
      const user = userEvent.setup()
      await openWorkspace(user)
      const toggle = screen.getByRole('button', { name: 'Review pane' })
      await user.click(toggle)

      await user.click(screen.getByRole('tab', { name: 'Pull request' }))
      expect(toggle).toHaveAttribute('aria-pressed', 'true')

      await user.click(screen.getByRole('button', { name: 'Close review' }))
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
    })

    it('is disabled while the daemon is disconnected', async () => {
      const user = userEvent.setup()
      await openWorkspace(user)
      expect(screen.getByRole('button', { name: 'Review pane' })).toBeEnabled()

      fakeBridge.disconnect()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Review pane' })).toBeDisabled()
      })
    })

    it('replaces the old text buttons', async () => {
      const user = userEvent.setup()
      await openWorkspace(user)

      for (const name of ['Changes', 'Pull request', 'Open in editor', 'Create draft PR']) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
      }
    })

    it('is not offered for the loose sessions', async () => {
      render(<App />)

      expect(await screen.findByTestId('pane-0')).toBeInTheDocument()
      expect(screen.queryByTestId('topbar-review')).not.toBeInTheDocument()
    })
  })
})
