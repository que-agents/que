import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject, makeWorkspace } from '@renderer/testing/fixtures'
import App from '../App'

const uploader = makeProject()
const retry = makeWorkspace({
  id: 'ws_01hzx3k9c2qf',
  name: 'app-1432-retry-logic',
  sessionId: 'b3c1d2e4-0000-4000-8000-1a2b3c4d5e6f'
})

async function openRetry(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  fakeBridge.seedProject(uploader)
  fakeBridge.seedWorkspace(retry)
  render(<App />)
  await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
}

describe('work-mode dialogs', () => {
  describe('new workspace', () => {
    it('previews the slug, refuses an invalid name, and creates the workspace', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(uploader)
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'New workspace in uploader' }))
      const dialog = screen.getByRole('dialog', { name: 'New workspace in uploader' })
      const name = within(dialog).getByRole('textbox', { name: 'Name' })
      const submit = within(dialog).getByRole('button', { name: 'Create workspace' })
      expect(name).toHaveFocus()

      await user.type(name, '!!!')
      expect(submit).toBeDisabled()
      expect(within(dialog).getByText(/Use letters, digits/)).toBeInTheDocument()

      await user.clear(name)
      await user.type(name, 'APP-1432 Retry logic')
      expect(
        within(dialog).getByText('Branch and folder: app-1432-retry-logic')
      ).toBeInTheDocument()
      await user.click(submit)

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      const [ws] = await window.que.workspace.list()
      expect(ws).toMatchObject({ name: 'app-1432-retry-logic', baseRef: 'origin/main' })
      expect(screen.getByTestId('topbar-title')).toHaveTextContent('app-1432-retry-logic')
      await waitFor(() => {
        expect(screen.getAllByRole('tab')).toHaveLength(1)
      })
    })

    it('returns focus to the opener when cancelled with Escape', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(uploader)
      render(<App />)
      const opener = await screen.findByRole('button', { name: 'New workspace in uploader' })
      await user.click(opener)

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(opener).toHaveFocus()
    })
  })

  describe('review pane', () => {
    it('creates a draft PR from Pull request and shows its URL', async () => {
      const user = userEvent.setup()
      await openRetry(user)
      await user.click(await screen.findByRole('button', { name: 'Review pane' }))
      await user.click(screen.getByRole('tab', { name: 'Pull request' }))

      await user.click(await screen.findByRole('button', { name: 'Create draft PR' }))
      const dialog = screen.getByRole('dialog', { name: `Draft PR from ${retry.branch}` })
      await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Add retry logic')
      await user.click(within(dialog).getByRole('button', { name: 'Create draft PR' }))

      const link = await within(dialog).findByRole('link', { name: /pull\/41$/ })
      expect(link).toHaveAttribute('href', 'https://github.com/rquellh/que/pull/41')
      expect(fakeBridge.createPrCalls()).toEqual([{ id: retry.id, title: 'Add retry logic' }])
      expect(screen.getByTestId('topbar-pr')).toHaveTextContent('PR #41')
    })
  })
})
