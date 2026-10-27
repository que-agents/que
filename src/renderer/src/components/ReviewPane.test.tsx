import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { openWorkspace } from '@renderer/testing/helpers'
import {
  makeProject,
  makePullRequest,
  makeWorkspace,
  makeWorkspaceDiff,
  makeWorkspaceFiles
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
  fakeBridge.seedFiles(makeWorkspaceFiles({ workspaceId: retry.id }))
}

describe('ReviewPane', () => {
  describe('opening and closing', () => {
    it('opens on Changes from the top bar, beside the terminal, which stays selected', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      const term = await openWorkspace(user, retry.id)
      expect(screen.queryByTestId('review-pane')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('topbar-review'))

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

    it('shows the Pull request tab and fetches the conversation once', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await openWorkspace(user, retry.id)
      await user.click(screen.getByTestId('topbar-review'))

      await user.click(screen.getByTestId('review-tab-pr'))

      const pane = screen.getByTestId('review-pane')
      expect(pane).toHaveAttribute('data-tab', 'pr')
      expect(await within(pane).findByTestId('pr-header-link')).toBeInTheDocument()
      expect(fakeBridge.prThreadCalls()).toEqual([{ id: retry.id, number: 41, refresh: false }])
    })

    it('holds Changes, Files and Pull request in that order; Files lists the worktree', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await openWorkspace(user, retry.id)
      await user.click(screen.getByTestId('topbar-review'))

      const tabs = within(screen.getByRole('tablist', { name: 'Review' })).getAllByRole('tab')
      expect(tabs.map((t) => t.textContent)).toEqual(['Changes', 'Files', 'Pull request'])
      expect(tabs[1]).toHaveAttribute('data-testid', 'review-tab-files')

      await user.click(tabs[1])

      const pane = screen.getByTestId('review-pane')
      expect(pane).toHaveAttribute('data-tab', 'files')
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
      expect(await within(pane).findByTestId('files-tree')).toBeInTheDocument()
      expect(screen.queryByTestId('changes-list')).not.toBeInTheDocument()
      expect(fakeBridge.filesCalls()).toEqual([retry.id])
    })

    it('runs the full height of the window beside the top bar, not under it', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await openWorkspace(user, retry.id)

      await user.click(screen.getByTestId('topbar-review'))

      const pane = screen.getByTestId('review-pane')
      expect(pane.parentElement).toBe(screen.getByTestId('app-shell'))
      expect(within(pane).queryByTestId('pane-controls')).not.toBeInTheDocument()
      expect(screen.getByTestId('app-shell')).toHaveStyle({ '--review-width': '320px' })
    })

    it('switches between its tabs and closes from its own button', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await openWorkspace(user, retry.id)
      await user.click(screen.getByTestId('topbar-review'))

      await user.click(screen.getByRole('tab', { name: 'Pull request' }))

      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'pr')
      expect(screen.getByTestId('review-tab-pr')).toHaveAttribute('data-active', 'true')
      expect(await screen.findByTestId('pr-view')).toBeInTheDocument()
      expect(screen.queryByTestId('changes-list')).not.toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Changes' }))
      expect(await screen.findByTestId('changes-list')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Close review' }))

      expect(screen.queryByTestId('review-pane')).not.toBeInTheDocument()
      expect(screen.getByTestId('topbar-review')).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('resizing', () => {
    it('widens with ArrowLeft, narrows with ArrowRight, stops at the limits, resets on double-click', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await openWorkspace(user, retry.id)
      await user.click(screen.getByTestId('topbar-review'))
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
      await openWorkspace(user, retry.id)
      await user.click(screen.getByTestId('topbar-review'))
      await user.click(screen.getByTestId('review-tab-pr'))
      screen.getByTestId('review-resizer').focus()
      await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}')
      first.unmount()

      render(<App />)
      await openWorkspace(user, retry.id)

      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'pr')
      expect(screen.getByTestId('review-resizer')).toHaveAttribute('aria-valuenow', '368')
      expect(await screen.findByTestId('pr-view')).toBeInTheDocument()
    })

    it('comes back on Files after the app reloads', async () => {
      const user = userEvent.setup()
      seed()
      const first = render(<App />)
      await openWorkspace(user, retry.id)
      await user.click(screen.getByTestId('topbar-review'))
      await user.click(screen.getByTestId('review-tab-files'))
      first.unmount()

      render(<App />)
      await openWorkspace(user, retry.id)

      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'files')
      expect(screen.getByTestId('review-tab-files')).toHaveAttribute('aria-selected', 'true')
      expect(await screen.findByTestId('files-tree')).toBeInTheDocument()
    })

    it('falls back to the defaults for an unreadable or out-of-range memory', async () => {
      const user = userEvent.setup()
      seed()
      localStorage.setItem('que.review', '{not json')
      const first = render(<App />)
      await openWorkspace(user, retry.id)
      expect(screen.queryByTestId('review-pane')).not.toBeInTheDocument()
      first.unmount()

      localStorage.setItem('que.review', JSON.stringify({ open: true, tab: 'notes', width: 9999 }))
      render(<App />)
      await openWorkspace(user, retry.id)

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

    it('says so on Files too, and lists nothing', async () => {
      const user = userEvent.setup()
      localStorage.setItem('que.review', JSON.stringify({ open: true, tab: 'files', width: 320 }))
      render(<App />)
      expect(await screen.findByTestId('review-empty')).toHaveTextContent('No workspace')

      await user.click(screen.getByTestId('review-tab-changes'))
      await user.click(screen.getByTestId('review-tab-files'))

      expect(screen.getByTestId('review-empty')).toHaveTextContent('No workspace')
      expect(screen.queryByTestId('files-tree')).not.toBeInTheDocument()
      expect(fakeBridge.filesCalls()).toEqual([])
    })
  })
})
