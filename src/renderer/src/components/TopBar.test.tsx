import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject, makePullRequest, makeWorkspace } from '@renderer/testing/fixtures'
import App from '../App'

const ID = 'ws_01hzx3k9c2qf'

describe('TopBar', () => {
  describe('the Pull request button', () => {
    it("carries the pull request's state, none without one, and toggles the review pane", async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(makeWorkspace({ id: ID, pr: null }))
      render(<App />)
      await user.click(await screen.findByTestId(`sidebar-workspace-${ID}-open`))
      const button = await screen.findByTestId('topbar-pull-request')
      expect(button).toHaveTextContent('Pull request')
      expect(button).toHaveAttribute('data-pr-state', 'none')
      expect(button).toHaveAttribute('aria-pressed', 'false')

      fakeBridge.setWorkspacePr(ID, makePullRequest({ state: 'open' }))

      expect(await screen.findByTestId('topbar-pr')).toBeInTheDocument()
      expect(button).toHaveAttribute('data-pr-state', 'open')

      await user.click(button)
      expect(button).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'pr')

      await user.click(button)
      expect(button).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByTestId('review-pane')).not.toBeInTheDocument()
    })
  })

  describe('the Changes button', () => {
    it('is pressed only while the review pane is open on Changes', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(makeWorkspace({ id: ID }))
      render(<App />)
      await user.click(await screen.findByTestId(`sidebar-workspace-${ID}-open`))
      const changes = await screen.findByTestId('topbar-changes')
      const pr = screen.getByTestId('topbar-pull-request')

      await user.click(changes)
      expect(changes).toHaveAttribute('aria-pressed', 'true')
      expect(pr).toHaveAttribute('aria-pressed', 'false')

      await user.click(screen.getByRole('tab', { name: 'Pull request' }))
      expect(changes).toHaveAttribute('aria-pressed', 'false')
      expect(pr).toHaveAttribute('aria-pressed', 'true')
    })

    it('is not offered for the loose sessions', async () => {
      render(<App />)

      expect(await screen.findByTestId('pane-0')).toBeInTheDocument()
      expect(screen.queryByTestId('topbar-changes')).not.toBeInTheDocument()
      expect(screen.queryByTestId('topbar-pull-request')).not.toBeInTheDocument()
    })
  })
})
