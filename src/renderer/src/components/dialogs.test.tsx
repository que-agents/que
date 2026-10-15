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
    it('names the branch from the first line of the brief, live, and refuses one it cannot name', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(uploader)
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'New workspace in uploader' }))
      const dialog = screen.getByRole('dialog', { name: 'New workspace in uploader' })
      const brief = within(dialog).getByRole('textbox', { name: 'What are you doing?' })
      const submit = within(dialog).getByRole('button', { name: 'Create workspace' })
      expect(brief).toHaveFocus()
      expect(submit).toBeDisabled()

      await user.type(brief, '✨🚀')
      expect(submit).toBeDisabled()
      expect(within(dialog).getByTestId('dialog-new-workspace-slug')).toHaveTextContent(
        'Start the first line with a letter or digit.'
      )

      await user.clear(brief)
      await user.type(brief, 'APP-1432 Retry logic{Shift>}{Enter}{/Shift}Back off three times.')
      expect(within(dialog).getByTestId('dialog-new-workspace-slug')).toHaveTextContent(
        'Branch and folder: app-1432-retry-logic'
      )
      expect(submit).toBeEnabled()
    })

    it('creates the workspace from the brief and starts claude in its only terminal', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(uploader)
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'New workspace in uploader' }))
      const dialog = screen.getByRole('dialog', { name: 'New workspace in uploader' })
      expect(
        within(dialog).getByRole('checkbox', { name: 'Start claude with this brief' })
      ).toBeChecked()
      await user.click(within(dialog).getByText('Advanced'))
      await user.type(within(dialog).getByRole('textbox', { name: /Base ref/ }), 'origin/release')

      await user.type(
        within(dialog).getByRole('textbox', { name: 'What are you doing?' }),
        'Add retry logic to the uploader{Shift>}{Enter}{/Shift}Back off exponentially.'
      )
      await user.keyboard('{Meta>}{Enter}{/Meta}')

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      expect(fakeBridge.createWorkspaceCalls()).toEqual([
        {
          projectId: uploader.id,
          brief: 'Add retry logic to the uploader\nBack off exponentially.',
          baseRef: 'origin/release'
        }
      ])
      const [ws] = await window.que.workspace.list()
      expect(ws).toMatchObject({
        name: 'add-retry-logic-to-the-uploader',
        title: 'Add retry logic to the uploader'
      })
      expect(fakeBridge.startCalls()).toEqual([ws.id])
      await waitFor(() => {
        expect(screen.getAllByRole('tab')).toHaveLength(1)
      })
      expect(await window.que.term.list({ workspaceId: ws.id })).toHaveLength(1)
    })

    it('only opens a shell when start is off', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(uploader)
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'New workspace in uploader' }))
      const dialog = screen.getByRole('dialog', { name: 'New workspace in uploader' })

      await user.type(
        within(dialog).getByRole('textbox', { name: 'What are you doing?' }),
        'Fix the flaky upload test'
      )
      await user.click(
        within(dialog).getByRole('checkbox', { name: 'Start claude with this brief' })
      )
      await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))

      await waitFor(() => {
        expect(screen.getAllByRole('tab')).toHaveLength(1)
      })
      expect(fakeBridge.startCalls()).toEqual([])
      expect(screen.getByTestId('topbar-title')).toHaveTextContent('fix-the-flaky-upload-test')
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
