import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject, makeTermInfo, makeWorkspace } from '@renderer/testing/fixtures'
import App from '../App'

const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })
const board = makeWorkspace({ id: 'ws_01hzx4m1p8rt', name: 'app-1440-quiet-board' })
const shell = makeTermInfo({ name: 'zsh', cwd: '/Users/dev' })
const retryTerm = makeTermInfo({ name: retry.name, cwd: retry.path, workspaceId: retry.id })

function seed(): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedWorkspace(board)
  fakeBridge.seedTerminal(shell)
  fakeBridge.seedTerminal(retryTerm)
}

describe('TerminalTabs', () => {
  describe('rendering', () => {
    it("shows only the selected workspace's terminals", async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      expect(await screen.findByTestId(`terminal-tab-${shell.id}`)).toBeInTheDocument()
      expect(screen.queryByTestId(`terminal-tab-${retryTerm.id}`)).not.toBeInTheDocument()

      await user.click(screen.getByTestId(`sidebar-workspace-${retry.id}-open`))

      expect(await screen.findByTestId(`terminal-tab-${retryTerm.id}`)).toBeInTheDocument()
      expect(screen.queryByTestId(`terminal-tab-${shell.id}`)).not.toBeInTheDocument()
      expect(screen.getByTestId(`sidebar-workspace-${retry.id}-open`)).toHaveAttribute(
        'aria-current',
        'page'
      )
      expect(screen.getAllByRole('tab')).toHaveLength(1)
    })

    it('marks an exited terminal on its tab, with no badge, and keeps its folder as the tooltip', async () => {
      fakeBridge.seedTerminal(shell)
      render(<App />)
      const tab = await screen.findByTestId(`terminal-tab-${shell.id}`)
      expect(tab).not.toHaveClass('exited')

      fakeBridge.exitTerminal(shell.id, 0)

      await waitFor(() => {
        expect(tab).toHaveClass('exited')
      })
      expect(screen.getByTestId(`terminal-tab-${shell.id}-exited`)).toHaveTextContent('zsh')
      expect(within(tab).queryByText(/exited/i)).not.toBeInTheDocument()
      expect(screen.getByTestId(`terminal-tab-${shell.id}-select`)).toHaveAttribute(
        'title',
        '/Users/dev'
      )
    })
  })

  describe("the tab's ×", () => {
    const node = makeTermInfo({ name: 'node', cwd: '/Users/dev/code/api' })

    // Shown or hidden is the stylesheet's opacity, checked in the split spec after a real hover.
    it('is rendered on every tab, active and inactive, so the tab keeps its width', async () => {
      fakeBridge.seedTerminal(shell)
      fakeBridge.seedTerminal(node)
      render(<App />)
      await screen.findByTestId(`terminal-tab-${node.id}`)

      expect(screen.getByTestId(`terminal-tab-${node.id}`)).toHaveClass('active')
      expect(screen.getByTestId(`terminal-tab-${shell.id}`)).not.toHaveClass('active')
      expect(screen.getByRole('button', { name: 'Close zsh' })).toHaveClass('close')
      expect(screen.getByRole('button', { name: 'Close node' })).toHaveClass('close')
    })
  })

  describe('user interactions', () => {
    it('opens a workspace terminal with +', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
      await screen.findByTestId(`terminal-tab-${retryTerm.id}`)

      await user.click(screen.getByRole('button', { name: 'New terminal' }))

      await waitFor(() => {
        expect(screen.getAllByRole('tab')).toHaveLength(2)
      })
      const opened = await window.que.term.list({ workspaceId: retry.id })
      expect(opened).toHaveLength(2)
      expect(opened.every((t) => t.cwd === retry.path)).toBe(true)
    })

    it('opens a terminal on the first visit to a workspace that has none, once', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)

      await user.click(await screen.findByTestId(`sidebar-workspace-${board.id}-open`))

      await waitFor(() => {
        expect(screen.getAllByRole('tab')).toHaveLength(1)
      })
      const [first] = await window.que.term.list({ workspaceId: board.id })
      expect(first.cwd).toBe(board.path)
      await user.click(screen.getByRole('button', { name: `Close ${board.name}` }))
      await user.click(screen.getAllByTestId(/^sidebar-session-.*-open$/)[0])
      await user.click(screen.getByTestId(`sidebar-workspace-${board.id}-open`))

      expect(await screen.findByTestId('terminal-empty')).toBeInTheDocument()
      expect(await window.que.term.list({ workspaceId: board.id })).toEqual([])
    })

    it('shows a terminal opened elsewhere (the CLI) under its workspace', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
      await screen.findByTestId(`terminal-tab-${retryTerm.id}`)

      const { id } = await window.que.workspace.openTerminal({ id: retry.id, cols: 80, rows: 24 })

      expect(await screen.findByTestId(`terminal-tab-${id}`)).toBeInTheDocument()
    })
  })
})
