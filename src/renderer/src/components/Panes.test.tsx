import { describe, expect, it } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { openWorkspace } from '@renderer/testing/helpers'
import {
  makeDiffFile,
  makeProject,
  makeTermInfo,
  makeWorkspace,
  makeWorkspaceDiff,
  makeWorkspaceFile,
  makeWorkspaceFiles
} from '@renderer/testing/fixtures'
import App from '../App'

const one = makeTermInfo({ name: 'one', cwd: '/Users/dev/a' })
const two = makeTermInfo({ name: 'two', cwd: '/Users/dev/b' })

const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })
const put = makeDiffFile()

const readme = makeDiffFile({
  path: 'README.md',
  status: 'added',
  additions: 1,
  deletions: 0,
  patch:
    'diff --git a/README.md b/README.md\n--- /dev/null\n+++ b/README.md\n@@ -0,0 +1,1 @@\n+# Uploader\n'
})

const SPLIT_BESIDE = '{Meta>}d{/Meta}'
const SPLIT_BELOW = '{Meta>}{Shift>}d{/Shift}{/Meta}'

function seed(): void {
  fakeBridge.seedTerminal(one)
  fakeBridge.seedTerminal(two)
}

function tabsIn(pane: number): HTMLElement[] {
  return within(screen.getByTestId(`pane-${pane}`)).getAllByRole('tab')
}

function seedWorkspace(): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files: [put, readme] }))
}

/** Opens the review pane on Changes. */
async function openChanges(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('topbar-review'))
  await screen.findByTestId('changes-list')
}

/** Splits beside and waits for the second pane to hold its new terminal. */
async function splitBeside(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  await user.keyboard(SPLIT_BESIDE)
  const pane = await screen.findByTestId('pane-1')
  await waitFor(() => {
    expect(pane.dataset.activeTerm).not.toBe('')
  })

  return pane.dataset.activeTerm as string
}

describe('Panes', () => {
  describe('rendering', () => {
    it('shows one pane with every tab until it is split', async () => {
      seed()
      render(<App />)

      expect(await screen.findByTestId('pane-0')).toHaveAttribute('data-focused', 'true')
      expect(tabsIn(0)).toHaveLength(2)
      expect(screen.queryByTestId('pane-1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('pane-divider')).not.toBeInTheDocument()
    })
  })

  describe('tab labels', () => {
    it('reads the program in the terminal, the name until it is known, and keeps the last program after exit', async () => {
      seed()
      render(<App />)

      const select = await screen.findByTestId(`terminal-tab-${one.id}-select`)
      expect(select).toHaveTextContent(/^one/)

      act(() => fakeBridge.updateTerminal(one.id, { title: undefined, process: 'claude' }))
      await waitFor(() => expect(select).toHaveTextContent(/^claude/))
      expect(screen.getByTestId(`terminal-tab-${one.id}-close`)).toHaveAccessibleName(
        'Close claude'
      )

      act(() => fakeBridge.updateTerminal(one.id, { title: undefined, process: 'zsh' }))
      await waitFor(() => expect(select).toHaveTextContent(/^zsh/))

      act(() => fakeBridge.exitTerminal(one.id, 0))
      expect(await screen.findByTestId(`terminal-tab-${one.id}-exited`)).toHaveTextContent('zsh')
    })

    it('holds the folder, the title the program set and the first four characters of the id in the tooltip', async () => {
      seed()
      render(<App />)

      const select = await screen.findByTestId(`terminal-tab-${one.id}-select`)
      expect(select).toHaveAttribute('title', `/Users/dev/a\n${one.id.slice(0, 4)}`)

      act(() => fakeBridge.updateTerminal(one.id, { title: '✳ Fix the bug', process: 'claude' }))
      await waitFor(() =>
        expect(select).toHaveAttribute(
          'title',
          `/Users/dev/a\n✳ Fix the bug\n${one.id.slice(0, 4)}`
        )
      )
    })
  })

  describe('splitting', () => {
    it('Cmd+D splits beside with a new focused terminal in the second pane', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)

      const created = await splitBeside(user)

      expect(created).not.toBe(two.id)
      expect(screen.getByTestId('pane-1')).toHaveAttribute('data-focused', 'true')
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'false')
      expect(tabsIn(0)).toHaveLength(2)
      expect(tabsIn(1)).toHaveLength(1)
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-active-term', two.id)
      expect(screen.getByTestId('pane-divider')).toHaveAttribute('aria-orientation', 'vertical')
      expect(await window.que.term.list()).toHaveLength(3)
    })

    it('shows a terminal another client opened, without asking the daemon for the list again', async () => {
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      const listed = fakeBridge.termListCount()
      const elsewhere = makeTermInfo({ name: 'logs', cwd: '/Users/dev/c' })

      act(() => fakeBridge.announceTerminal(elsewhere))

      expect(await screen.findByTestId(`terminal-tab-${elsewhere.id}`)).toBeInTheDocument()
      expect(fakeBridge.termListCount()).toBe(listed)
    })

    it('Cmd+Shift+D splits below', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)

      await user.keyboard(SPLIT_BELOW)

      expect(await screen.findByTestId('pane-1')).toBeInTheDocument()
      expect(screen.getByTestId('pane-divider')).toHaveAttribute('aria-orientation', 'horizontal')
    })

    it('the tab row buttons split, and join the panes without killing anything', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)

      await user.click(screen.getByRole('button', { name: 'Split beside' }))
      await screen.findByTestId('pane-1')
      expect(screen.queryByRole('button', { name: 'Split beside' })).not.toBeInTheDocument()
      const before = await window.que.term.list()

      await user.click(screen.getByRole('button', { name: 'Join panes' }))

      await waitFor(() => {
        expect(screen.queryByTestId('pane-1')).not.toBeInTheDocument()
      })
      expect(tabsIn(0)).toHaveLength(3)
      expect(await window.que.term.list()).toHaveLength(before.length)
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')

      await user.click(screen.getByRole('button', { name: 'Split below' }))
      expect(await screen.findByTestId('pane-divider')).toHaveAttribute(
        'aria-orientation',
        'horizontal'
      )
    })
  })

  describe('focus and tabs', () => {
    it('Cmd+T opens in the focused pane; clicking a tab in the other pane focuses it', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)

      await user.keyboard('{Meta>}t{/Meta}')
      await waitFor(() => {
        expect(tabsIn(1)).toHaveLength(2)
      })
      expect(tabsIn(0)).toHaveLength(2)

      await user.click(screen.getByTestId(`terminal-tab-${one.id}-select`))

      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-active-term', one.id)
      expect(screen.getByTestId(`terminal-tab-${one.id}-select`)).toHaveAttribute(
        'aria-selected',
        'true'
      )

      await user.keyboard('{Meta>}t{/Meta}')
      await waitFor(() => {
        expect(tabsIn(0)).toHaveLength(3)
      })
      expect(tabsIn(1)).toHaveLength(2)
    })

    it('the + of a pane opens a terminal there and focuses it', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)

      await user.click(screen.getByTestId('pane-0-new'))

      await waitFor(() => {
        expect(tabsIn(0)).toHaveLength(3)
      })
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')
    })

    it('Cmd+Option+arrows move focus between the panes', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)

      await user.keyboard('{Meta>}{Alt>}{ArrowLeft}{/Alt}{/Meta}')
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')

      await user.keyboard('{Meta>}{Alt>}{ArrowRight}{/Alt}{/Meta}')
      expect(screen.getByTestId('pane-1')).toHaveAttribute('data-focused', 'true')

      await user.keyboard('{Meta>}{Alt>}{ArrowUp}{/Alt}{/Meta}')
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')
    })
  })

  describe('the controls', () => {
    it('sit at the right end of the one strip, after the + and the tabs', async () => {
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)

      const strip = within(screen.getByTestId('pane-0'))
      const controls = strip.getByTestId('pane-controls')
      expect(within(controls).getByTestId('topbar-split-beside')).toHaveAttribute(
        'title',
        'Split beside (⌘D)'
      )
      expect(within(controls).getByTestId('topbar-split-below')).toHaveAttribute(
        'title',
        'Split below (⌘⇧D)'
      )
      expect(
        strip.getByTestId('pane-0-new').compareDocumentPosition(controls) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    it("move to the second pane's strip with a beside split: the top-right corner", async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)

      await splitBeside(user)

      expect(within(screen.getByTestId('pane-1')).getByTestId('topbar-join')).toHaveAttribute(
        'title',
        "Join panes: the second pane's tabs move to the first"
      )
      expect(
        within(screen.getByTestId('pane-0')).queryByTestId('pane-controls')
      ).not.toBeInTheDocument()
      expect(screen.getAllByTestId('pane-controls')).toHaveLength(1)
    })

    it("stay in the first pane's strip with a below split", async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)

      await user.keyboard(SPLIT_BELOW)
      await screen.findByTestId('pane-1')

      expect(within(screen.getByTestId('pane-0')).getByTestId('topbar-join')).toBeInTheDocument()
      expect(
        within(screen.getByTestId('pane-1')).queryByTestId('pane-controls')
      ).not.toBeInTheDocument()
    })
  })

  describe('the review toggle', () => {
    async function openRetry(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(retry)
      render(<App />)
      await openWorkspace(user, retry.id)
      await screen.findByTestId('topbar-review')
    }

    it('opens the review pane and closes it again, pressed while it is open', async () => {
      const user = userEvent.setup()
      await openRetry(user)
      const toggle = screen.getByRole('button', { name: 'Review pane' })
      expect(toggle).toHaveAttribute('data-testid', 'topbar-review')
      expect(toggle).toHaveAttribute('title', 'Review pane: changes and pull request (⌘B)')
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      expect(
        within(screen.getByTestId('pane-controls')).getByRole('button', { name: 'Review pane' })
      ).toBe(toggle)

      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'changes')

      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByTestId('review-pane')).not.toBeInTheDocument()
    })

    it('Cmd+B toggles the review pane too', async () => {
      const user = userEvent.setup()
      await openRetry(user)

      await user.keyboard('{Meta>}b{/Meta}')

      expect(await screen.findByTestId('review-pane')).toBeInTheDocument()
      expect(screen.getByTestId('topbar-review')).toHaveAttribute('aria-pressed', 'true')
    })

    it('opens on the tab the pane was last left on', async () => {
      const user = userEvent.setup()
      localStorage.setItem('que.review', JSON.stringify({ open: false, tab: 'pr', width: 320 }))
      await openRetry(user)

      await user.click(screen.getByRole('button', { name: 'Review pane' }))

      expect(screen.getByTestId('review-pane')).toHaveAttribute('data-tab', 'pr')
      expect(screen.getByTestId('review-tab-pr')).toHaveAttribute('aria-selected', 'true')
    })

    it('stays pressed while switching tabs and unpresses when the pane closes itself', async () => {
      const user = userEvent.setup()
      await openRetry(user)
      const toggle = screen.getByRole('button', { name: 'Review pane' })
      await user.click(toggle)

      await user.click(screen.getByRole('tab', { name: 'Pull request' }))
      expect(toggle).toHaveAttribute('aria-pressed', 'true')

      await user.click(screen.getByRole('button', { name: 'Close review' }))
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
    })

    it('is disabled while the daemon is disconnected', async () => {
      const user = userEvent.setup()
      await openRetry(user)
      expect(screen.getByRole('button', { name: 'Review pane' })).toBeEnabled()

      fakeBridge.disconnect()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Review pane' })).toBeDisabled()
      })
    })

    it('is not offered for the loose sessions, which keep the split buttons', async () => {
      render(<App />)

      expect(await screen.findByTestId('pane-0')).toBeInTheDocument()
      expect(screen.queryByTestId('topbar-review')).not.toBeInTheDocument()
      expect(screen.getByTestId('topbar-split-beside')).toBeInTheDocument()
    })
  })

  describe('closing', () => {
    it('Cmd+W closes the focused pane active tab', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)
      await user.click(screen.getByTestId(`terminal-tab-${one.id}-select`))

      await user.keyboard('{Meta>}w{/Meta}')

      await waitFor(() => {
        expect(fakeBridge.getTerminal(one.id)).toBeUndefined()
      })
      expect(tabsIn(0)).toHaveLength(1)
      expect(tabsIn(1)).toHaveLength(1)
    })

    it("closing the second pane's last tab collapses the split and refocuses the first", async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)

      await user.keyboard('{Meta>}w{/Meta}')

      await waitFor(() => {
        expect(screen.queryByTestId('pane-1')).not.toBeInTheDocument()
      })
      expect(screen.queryByTestId('pane-divider')).not.toBeInTheDocument()
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')
      expect(tabsIn(0)).toHaveLength(2)
    })

    it("closing the first pane's last tab moves the second pane's tabs over", async () => {
      const user = userEvent.setup()
      fakeBridge.seedTerminal(one)
      render(<App />)
      await screen.findByTestId(`terminal-tab-${one.id}`)
      const created = await splitBeside(user)

      await user.click(screen.getByRole('button', { name: 'Close one' }))

      await waitFor(() => {
        expect(screen.queryByTestId('pane-1')).not.toBeInTheDocument()
      })
      expect(tabsIn(0)).toHaveLength(1)
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-active-term', created)
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-focused', 'true')
    })
  })

  describe('the divider', () => {
    it('moves with the arrow keys, clamps, and resets on double-click', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await splitBeside(user)
      const panes = screen.getByTestId('panes')
      const divider = screen.getByTestId('pane-divider')
      expect(panes).toHaveAttribute('data-ratio', '0.5')

      divider.focus()
      await user.keyboard('{ArrowRight}')
      expect(panes).toHaveAttribute('data-ratio', '0.55')
      expect(panes.style.gridTemplateColumns).toBe('0.55fr 7px 0.45fr')
      await user.keyboard('{ArrowLeft}{ArrowLeft}')
      expect(panes).toHaveAttribute('data-ratio', '0.45')

      await user.keyboard('{Home}')
      expect(panes).toHaveAttribute('data-ratio', '0.2')
      await user.keyboard('{ArrowLeft}')
      expect(panes).toHaveAttribute('data-ratio', '0.2')

      await user.dblClick(divider)
      expect(panes).toHaveAttribute('data-ratio', '0.5')
    })

    it('uses rows for a split below, moved by the up and down arrows', async () => {
      const user = userEvent.setup()
      seed()
      render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      await user.keyboard(SPLIT_BELOW)
      const divider = await screen.findByTestId('pane-divider')

      divider.focus()
      await user.keyboard('{ArrowDown}')

      expect(screen.getByTestId('panes').style.gridTemplateRows).toBe('0.55fr 7px 0.45fr')
    })
  })

  describe('remembering', () => {
    it('restores the split and both panes after the app reloads', async () => {
      const user = userEvent.setup()
      seed()
      const first = render(<App />)
      await screen.findByTestId(`terminal-tab-${two.id}`)
      const created = await splitBeside(user)
      screen.getByTestId('pane-divider').focus()
      await user.keyboard('{ArrowRight}')
      first.unmount()

      render(<App />)

      expect(await screen.findByTestId('pane-1')).toHaveAttribute('data-active-term', created)
      expect(tabsIn(0)).toHaveLength(2)
      expect(tabsIn(1)).toHaveLength(1)
      expect(screen.getByTestId('pane-divider')).toHaveAttribute('aria-orientation', 'vertical')
      expect(await window.que.term.list()).toHaveLength(3)
    })

    it('drops a remembered terminal that no longer exists', async () => {
      seed()
      localStorage.setItem(
        'que.layout.',
        JSON.stringify({
          split: { direction: 'row', ratio: 0.5 },
          second: [one.id, 'gone-terminal'],
          active: [null, 'gone-terminal'],
          focused: 1
        })
      )

      render(<App />)

      expect(await screen.findByTestId('pane-1')).toBeInTheDocument()
      expect(tabsIn(0)).toHaveLength(1)
      expect(tabsIn(1)).toHaveLength(1)
      expect(screen.getByTestId('pane-1')).toHaveAttribute('data-active-term', one.id)
    })

    it('collapses a remembered split whose second pane is gone', async () => {
      seed()
      localStorage.setItem(
        'que.layout.',
        JSON.stringify({
          split: { direction: 'row', ratio: 0.5 },
          second: ['gone-terminal'],
          active: [null, null],
          focused: 1
        })
      )

      render(<App />)

      await screen.findByTestId('pane-0')
      expect(screen.queryByTestId('pane-1')).not.toBeInTheDocument()
      expect(tabsIn(0)).toHaveLength(2)
    })
  })

  describe('diff tabs', () => {
    it('opens a file beside the terminal tab; selecting either shows it; again focuses it', async () => {
      const user = userEvent.setup()
      seedWorkspace()
      render(<App />)
      const term = await openWorkspace(user, retry.id)
      await openChanges(user)

      await user.click(await screen.findByTestId('changes-file-0'))

      const pane = screen.getByTestId('pane-0')
      const tab = within(pane).getByTestId('view-tab-diff')
      expect(screen.getByTestId(`terminal-tab-${term}`)).toBeInTheDocument()
      expect(tab).toHaveAttribute('data-path', 'src/upload/put.ts')
      expect(tab).toHaveAttribute('data-active', 'true')
      const select = within(tab).getByTestId('view-tab-diff-select')
      expect(select).toHaveTextContent('put.ts')
      expect(select).toHaveAttribute('title', 'src/upload/put.ts')
      expect(pane).toHaveAttribute('data-active-tab', 'view:diff:src/upload/put.ts')
      expect(pane).toHaveAttribute('data-active-term', '')
      expect(within(pane).getByTestId('diff-view')).toBeInTheDocument()

      await user.click(screen.getByTestId(`terminal-tab-${term}-select`))

      expect(pane).toHaveAttribute('data-active-term', term)
      expect(tab).toHaveAttribute('data-active', 'false')
      expect(screen.queryByTestId('diff-view')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('changes-file-0'))

      expect(within(pane).getAllByTestId('view-tab-diff')).toHaveLength(1)
      expect(pane).toHaveAttribute('data-active-tab', 'view:diff:src/upload/put.ts')

      await user.click(screen.getByTestId(`terminal-tab-${term}-select`))
      await user.click(select)

      expect(pane).toHaveAttribute('data-active-tab', 'view:diff:src/upload/put.ts')
    })

    it('closes with Cmd+W and the close button, selecting the neighbour, killing nothing', async () => {
      const user = userEvent.setup()
      seedWorkspace()
      render(<App />)
      const term = await openWorkspace(user, retry.id)
      await openChanges(user)
      await user.click(await screen.findByTestId('changes-file-0'))
      await user.click(screen.getByTestId('changes-file-1'))
      const pane = screen.getByTestId('pane-0')
      expect(pane).toHaveAttribute('data-active-tab', 'view:diff:README.md')

      await user.keyboard('{Meta>}w{/Meta}')

      expect(within(pane).getAllByTestId('view-tab-diff')).toHaveLength(1)
      expect(pane).toHaveAttribute('data-active-tab', 'view:diff:src/upload/put.ts')

      await user.click(screen.getByRole('button', { name: 'Close put.ts' }))

      expect(screen.queryByTestId('view-tab-diff')).not.toBeInTheDocument()
      expect(pane).toHaveAttribute('data-active-term', term)
      expect(fakeBridge.getTerminal(term)).toBeDefined()
    })

    it('opens in the focused second pane, which outlives its last terminal', async () => {
      const user = userEvent.setup()
      seedWorkspace()
      render(<App />)
      await openWorkspace(user, retry.id)
      const created = await splitBeside(user)
      await openChanges(user)

      await user.click(await screen.findByTestId('changes-file-1'))

      const second = screen.getByTestId('pane-1')
      expect(within(second).getByTestId('view-tab-diff')).toHaveAttribute('data-active', 'true')
      expect(within(second).getByTestId('diff-view')).toHaveAttribute('data-path', 'README.md')

      await user.click(screen.getByTestId(`terminal-tab-${created}-close`))

      await waitFor(() => {
        expect(fakeBridge.getTerminal(created)).toBeUndefined()
      })
      expect(screen.getByTestId('pane-1')).toHaveAttribute('data-active-tab', 'view:diff:README.md')
      expect(within(screen.getByTestId('pane-1')).getAllByRole('tab')).toHaveLength(1)
    })

    it('comes back in its pane after the app reloads', async () => {
      const user = userEvent.setup()
      seedWorkspace()
      const first = render(<App />)
      const term = await openWorkspace(user, retry.id)
      await openChanges(user)
      await user.click(await screen.findByTestId('changes-file-1'))
      first.unmount()

      render(<App />)
      await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))

      const pane = await screen.findByTestId('pane-0')
      expect(within(pane).getByTestId('view-tab-diff')).toHaveAttribute('data-active', 'true')
      expect(within(pane).getByTestId(`terminal-tab-${term}`)).toBeInTheDocument()
      expect(await within(pane).findByTestId('diff-patch')).toHaveTextContent('+# Uploader')
    })
  })
  describe('file tabs', () => {
    it('opens a worktree file beside the terminal tab with its own testids, and closes it', async () => {
      const user = userEvent.setup()
      seedWorkspace()
      fakeBridge.seedFiles(makeWorkspaceFiles({ workspaceId: retry.id }))
      fakeBridge.seedFile(makeWorkspaceFile({ workspaceId: retry.id, path: 'src/index.ts' }))
      render(<App />)
      const term = await openWorkspace(user, retry.id)
      await openChanges(user)
      await user.click(screen.getByTestId('changes-file-0'))
      await user.click(screen.getByTestId('review-tab-files'))
      const index = await screen.findByTestId('files-row-5')
      expect(index).toHaveAttribute('data-path', 'src/index.ts')

      await user.click(index)

      const pane = screen.getByTestId('pane-0')
      const tab = within(pane).getByTestId('view-tab-file')
      expect(tab).toHaveAttribute('data-path', 'src/index.ts')
      expect(tab).toHaveAttribute('data-active', 'true')
      const select = within(tab).getByTestId('view-tab-file-select')
      expect(select).toHaveTextContent('index.ts')
      expect(select).toHaveAttribute('title', 'src/index.ts')
      expect(select).toHaveAttribute('data-path', 'src/index.ts')
      expect(within(pane).getByTestId('view-tab-diff')).toHaveAttribute('data-active', 'false')
      expect(
        tabsIn(0)
          .map((t) => t.textContent)
          .slice(1)
      ).toEqual(['put.ts', 'index.ts'])
      expect(pane).toHaveAttribute('data-active-tab', 'view:file:src/index.ts')
      expect(await within(pane).findByTestId('file-text')).toHaveTextContent(
        'export const retries = 3'
      )
      expect(screen.queryByTestId('diff-view')).not.toBeInTheDocument()

      const close = within(tab).getByTestId('view-tab-file-close')
      expect(close).toHaveAttribute('data-path', 'src/index.ts')
      await user.click(close)

      expect(screen.queryByTestId('view-tab-file')).not.toBeInTheDocument()
      expect(pane).toHaveAttribute('data-active-tab', 'view:diff:src/upload/put.ts')
      expect(screen.getByTestId(`terminal-tab-${term}`)).toBeInTheDocument()
    })

    it('comes back beside a diff tab after the app reloads', async () => {
      const user = userEvent.setup()
      seedWorkspace()
      fakeBridge.seedFiles(makeWorkspaceFiles({ workspaceId: retry.id }))
      fakeBridge.seedFile(makeWorkspaceFile({ workspaceId: retry.id, path: 'package.json' }))
      const first = render(<App />)
      await openWorkspace(user, retry.id)
      await openChanges(user)
      await user.click(screen.getByTestId('changes-file-0'))
      await user.click(screen.getByTestId('review-tab-files'))
      const pkg = await screen.findByTestId('files-row-7')
      expect(pkg).toHaveAttribute('data-path', 'package.json')
      await user.click(pkg)
      first.unmount()

      render(<App />)
      await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))

      const pane = await screen.findByTestId('pane-0')
      expect(within(pane).getByTestId('view-tab-diff')).toHaveAttribute(
        'data-path',
        'src/upload/put.ts'
      )
      expect(within(pane).getByTestId('view-tab-file')).toHaveAttribute('data-active', 'true')
      expect(await within(pane).findByTestId('file-view')).toHaveAttribute(
        'data-path',
        'package.json'
      )
    })
  })
})
