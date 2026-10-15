import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import {
  makeProject,
  makePullRequest,
  makeWorkspace,
  makeWorkspaceDiff
} from '@renderer/testing/fixtures'
import App from '../App'

const retry = makeWorkspace({
  id: 'ws_01hzx3k9c2qf',
  name: 'app-1432-retry-logic',
  pr: makePullRequest()
})

function seed(): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id }))
}

/** Opens the workspace and waits for its first terminal; returns that terminal's id. */
async function openWorkspace(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
  const pane = await screen.findByTestId('pane-0')
  await waitFor(() => {
    expect(pane.dataset.activeTerm).not.toBe('')
  })
  return pane.dataset.activeTerm as string
}

describe('ReviewPane', () => {
  describe('opening and closing', () => {
    it('opens on Changes from the top bar, beside the terminal, which stays selected', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      const term = await openWorkspace(user)
      expect(screen.queryByTestId('review-pane')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('topbar-changes'))

      const pane = screen.getByTestId('review-pane')
      expect(pane).toHaveAttribute('data-tab', 'changes')
      expect(within(pane).getByTestId('review-tab-changes')).toHaveAttribute(
        'aria-selected',
        'true'
      )
      expect(await within(pane).findByTestId('changes-file-0')).toHaveTextContent(
        'src/upload/put.ts'
      )
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-active-term', term)
      expect(screen.getByTestId('review-resizer')).toHaveAttribute('aria-valuenow', '320')
    })

    it('opens on Pull request from the top bar and fetches the conversation once', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await openWorkspace(user)

      await user.click(screen.getByTestId('topbar-pull-request'))

      const pane = screen.getByTestId('review-pane')
      expect(pane).toHaveAttribute('data-tab', 'pr')
      expect(await within(pane).findByTestId('pr-header-link')).toBeInTheDocument()
      expect(fakeBridge.prThreadCalls()).toEqual([{ id: retry.id, refresh: false }])
    })

    it('closes from the button already pressed, and moves over from the other one', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await openWorkspace(user)
      const changes = screen.getByTestId('topbar-changes')
      const pr = screen.getByTestId('topbar-pull-request')

      await user.click(changes)
      await user.click(pr)

      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'pr')
      expect(pr).toHaveAttribute('aria-pressed', 'true')
      expect(changes).toHaveAttribute('aria-pressed', 'false')

      await user.click(pr)

      expect(screen.queryByTestId('review-pane')).not.toBeInTheDocument()
      expect(pr).toHaveAttribute('aria-pressed', 'false')
    })

    it('switches between its tabs and closes from its own button', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await openWorkspace(user)
      await user.click(screen.getByTestId('topbar-changes'))

      await user.click(screen.getByRole('tab', { name: 'Pull request' }))

      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'pr')
      expect(screen.getByTestId('review-tab-pr')).toHaveAttribute('data-active', 'true')
      expect(await screen.findByTestId('pr-view')).toBeInTheDocument()
      expect(screen.queryByTestId('changes-list')).not.toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Changes' }))
      expect(await screen.findByTestId('changes-list')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Close review' }))

      expect(screen.queryByTestId('review-pane')).not.toBeInTheDocument()
      expect(screen.getByTestId('topbar-changes')).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('resizing', () => {
    it('widens with ArrowLeft, narrows with ArrowRight, stops at the limits, resets on double-click', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await openWorkspace(user)
      await user.click(screen.getByTestId('topbar-changes'))
      const resizer = screen.getByRole('separator', { name: 'Resize review' })
      expect(resizer).toHaveAttribute('data-testid', 'review-resizer')
      expect(resizer).toHaveAttribute('aria-orientation', 'vertical')

      resizer.focus()
      await user.keyboard('{ArrowLeft}{ArrowLeft}')
      expect(resizer).toHaveAttribute('aria-valuenow', '352')
      await user.keyboard('{ArrowRight}')
      expect(resizer).toHaveAttribute('aria-valuenow', '336')
      await user.keyboard('{End}{ArrowLeft}')
      expect(resizer).toHaveAttribute('aria-valuenow', '520')
      await user.keyboard('{Home}{ArrowRight}')
      expect(resizer).toHaveAttribute('aria-valuenow', '240')

      await user.dblClick(resizer)

      expect(resizer).toHaveAttribute('aria-valuenow', '320')
    })
  })

  describe('persistence', () => {
    it('comes back open on its tab at its width after the app reloads', async () => {
      const user = userEvent.setup()
      seed()
      const first = render(<App />)
      await openWorkspace(user)
      await user.click(screen.getByTestId('topbar-pull-request'))
      screen.getByTestId('review-resizer').focus()
      await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}')
      first.unmount()

      render(<App />)
      await openWorkspace(user)

      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'pr')
      expect(screen.getByTestId('review-resizer')).toHaveAttribute('aria-valuenow', '368')
      expect(await screen.findByTestId('pr-view')).toBeInTheDocument()
    })

    it('falls back to the defaults for an unreadable or out-of-range memory', async () => {
      const user = userEvent.setup()
      seed()
      localStorage.setItem('que.review', '{not json')
      const first = render(<App />)
      await openWorkspace(user)
      expect(screen.queryByTestId('review-pane')).not.toBeInTheDocument()
      first.unmount()

      localStorage.setItem('que.review', JSON.stringify({ open: true, tab: 'files', width: 9999 }))
      render(<App />)
      await openWorkspace(user)

      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'changes')
      expect(screen.getByTestId('review-resizer')).toHaveAttribute('aria-valuenow', '520')
    })
  })

  describe('the loose sessions', () => {
    it('says there is no workspace to review', async () => {
      localStorage.setItem('que.review', JSON.stringify({ open: true, tab: 'changes', width: 320 }))

      render(<App />)

      expect(await screen.findByTestId('review-empty')).toHaveTextContent('No workspace')
      expect(screen.queryByTestId('changes-list')).not.toBeInTheDocument()
    })
  })
})
