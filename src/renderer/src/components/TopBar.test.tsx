import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject, makePullRequest, makeWorkspace } from '@renderer/testing/fixtures'
import App from '../App'

const ID = 'ws_01hzx3k9c2qf'

describe('TopBar', () => {
  describe('the Pull request button', () => {
    it("carries the pull request's state, none without one, and toggles the tab", async () => {
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
      expect(screen.getByTestId('view-tab-pr')).toBeInTheDocument()

      await user.click(button)
      expect(button).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByTestId('view-tab-pr')).not.toBeInTheDocument()
    })
  })
})
