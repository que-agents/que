import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import {
  makeDiffFile,
  makeProject,
  makeWorkspace,
  makeWorkspaceDiff
} from '@renderer/testing/fixtures'
import App from '../App'
import { QueStore, StoreContext } from '../store'
import ChangesList from './ChangesList'

const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })
const put = makeDiffFile()
const readme = makeDiffFile({
  path: 'README.md',
  status: 'added',
  additions: 4,
  deletions: 0,
  patch:
    'diff --git a/README.md b/README.md\n--- /dev/null\n+++ b/README.md\n@@ -0,0 +1,1 @@\n+# Uploader\n'
})

function seed(files = [put, readme]): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files }))
}

/** Opens the workspace, waits for its terminal, and opens the review pane on Changes. */
async function openChanges(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  render(<App />)
  await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
  const pane = await screen.findByTestId('pane-0')
  await waitFor(() => {
    expect(pane.dataset.activeTerm).not.toBe('')
  })
  await user.click(screen.getByRole('button', { name: 'Review pane' }))
  return pane.dataset.activeTerm as string
}

describe('ChangesList', () => {
  describe('rendering', () => {
    it('shows the summary and each file with its glyph and counts', async () => {
      const user = userEvent.setup()
      seed()

      await openChanges(user)

      const summary = await screen.findByTestId('changes-summary')
      expect(summary).toHaveTextContent('Commits 2 vs origin/main')
      expect(summary).toHaveAttribute(
        'title',
        'app-1432-retry-logic vs origin/main · 2 commits ahead · 2 files · +16 −3'
      )
      expect(screen.getByTestId('changes-commits')).toHaveTextContent('2')
      expect(screen.getByTestId('changes-base')).toHaveTextContent('origin/main')
      const first = screen.getByTestId('changes-file-0')
      expect(first).toHaveTextContent('Msrc/upload/put.ts+12 −3')
      expect(first).toHaveAttribute('data-path', 'src/upload/put.ts')
      expect(first).toHaveAttribute('data-active', 'false')
      expect(screen.getByTestId('changes-file-1')).toHaveTextContent('AREADME.md+4 −0')
    })

    it('marks an uncommitted file and shows where a rename came from', async () => {
      const user = userEvent.setup()
      seed([
        makeDiffFile({ dirty: true }),
        makeDiffFile({ path: 'src/new.ts', from: 'src/old.ts', status: 'renamed' })
      ])

      await openChanges(user)

      expect(await screen.findByTitle('uncommitted')).toHaveTextContent('*')
      expect(screen.getByTestId('changes-file-1')).toHaveTextContent('src/old.ts → src/new.ts')
    })

    it('says so for an empty diff', async () => {
      const user = userEvent.setup()
      seed([])

      await openChanges(user)

      expect(await screen.findByTestId('changes-empty')).toHaveTextContent(
        'No changes against origin/main.'
      )
      expect(screen.queryByTestId('changes-files')).not.toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('opens the clicked file as a diff tab beside the terminal and marks its row', async () => {
      const user = userEvent.setup()
      seed()
      const term = await openChanges(user)

      await user.click(await screen.findByTestId('changes-file-1'))

      const pane = screen.getByTestId('pane-0')
      expect(within(pane).getByTestId(`terminal-tab-${term}`)).toBeInTheDocument()
      expect(within(pane).getByTestId('view-tab-diff')).toHaveAttribute('data-path', 'README.md')
      expect(pane).toHaveAttribute('data-active-tab', 'view:diff:README.md')
      expect(within(pane).getByTestId('diff-view')).toHaveAttribute('data-path', 'README.md')
      expect(screen.getByTestId('changes-file-1')).toHaveAttribute('data-active', 'true')
      expect(screen.getByTestId('changes-file-0')).toHaveAttribute('data-active', 'false')

      await user.click(screen.getByTestId(`terminal-tab-${term}-select`))

      expect(screen.getByTestId('changes-file-1')).toHaveAttribute('data-active', 'false')
    })

    it('moves a cursor with the arrow keys and opens its file with Enter', async () => {
      const user = userEvent.setup()
      seed()
      await openChanges(user)
      const list = await screen.findByTestId('changes-files')
      expect(screen.getByTestId('changes-file-0')).toHaveAttribute('aria-selected', 'true')

      list.focus()
      await user.keyboard('{ArrowDown}')
      expect(screen.getByTestId('changes-file-1')).toHaveAttribute('aria-selected', 'true')
      await user.keyboard('{ArrowDown}')
      expect(screen.getByTestId('changes-file-1')).toHaveAttribute('aria-selected', 'true')
      await user.keyboard('{ArrowUp}')
      expect(screen.getByTestId('changes-file-0')).toHaveAttribute('aria-selected', 'true')
      await user.keyboard('{Enter}')

      expect(screen.getByTestId('pane-0')).toHaveAttribute(
        'data-active-tab',
        'view:diff:src/upload/put.ts'
      )
      expect(screen.getByTestId('changes-file-0')).toHaveAttribute('data-active', 'true')
    })

    it('Refresh fetches the diff again', async () => {
      const user = userEvent.setup()
      seed([put])
      await openChanges(user)
      await screen.findByTestId('changes-file-0')

      fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files: [put, readme] }))
      const refresh = screen.getByRole('button', { name: 'Refresh' })
      expect(refresh).toHaveAttribute('data-testid', 'changes-refresh')
      await user.click(refresh)

      expect(await screen.findByTestId('changes-file-1')).toHaveTextContent('README.md')
      expect(screen.getByTestId('changes-summary')).toHaveAttribute(
        'title',
        expect.stringContaining('· 2 files ·')
      )
    })

    it('opens the worktree in the editor, and not while disconnected', async () => {
      const user = userEvent.setup()
      seed()
      await openChanges(user)
      const open = await screen.findByRole('button', { name: 'Open in editor' })
      expect(open).toHaveAttribute('data-testid', 'changes-open-editor')

      await user.click(open)

      await waitFor(() => {
        expect(fakeBridge.openInEditorCalls()).toEqual([retry.path])
      })

      fakeBridge.disconnect()

      await waitFor(() => {
        expect(open).toBeDisabled()
      })
    })
  })

  describe('errors', () => {
    it('shows the refusal and no files during quiet hours', async () => {
      seed()
      fakeBridge.setQuietState({ inQuietHours: true, unlockedUntil: null })

      render(
        <StoreContext.Provider value={new QueStore(window.que)}>
          <ChangesList termKey={retry.id} />
        </StoreContext.Provider>
      )

      expect(await screen.findByTestId('changes-error')).toHaveTextContent('quiet hours')
      expect(screen.queryByTestId('changes-files')).not.toBeInTheDocument()
    })
  })
})
