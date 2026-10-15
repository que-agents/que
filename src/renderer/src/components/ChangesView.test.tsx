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
import ChangesView from './ChangesView'

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

async function openChanges(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
  await user.click(await screen.findByRole('button', { name: 'Changes' }))
}

function seed(files = [put, readme]): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files }))
}

describe('ChangesView', () => {
  describe('rendering', () => {
    it('shows the summary, the files with glyphs and counts, and the first patch', async () => {
      const user = userEvent.setup()
      seed()

      await openChanges(user)

      expect(await screen.findByTestId('changes-summary')).toHaveTextContent(
        'app-1432-retry-logic vs origin/main · 2 commits ahead · 2 files · +16 −3'
      )
      const first = screen.getByTestId('changes-file-0')
      expect(first).toHaveAttribute('aria-selected', 'true')
      expect(first).toHaveTextContent('Msrc/upload/put.ts+12 −3')
      expect(screen.getByTestId('changes-file-1')).toHaveTextContent('AREADME.md+4 −0')
      expect(screen.getByTestId('changes-file-1')).toHaveAttribute('aria-selected', 'false')
      const patch = screen.getByTestId('changes-patch')
      expect(within(patch).getByText('+const retries = 3')).toHaveAttribute('data-kind', 'added')
      expect(within(patch).getByText('-const retries = 1')).toHaveAttribute('data-kind', 'removed')
      expect(within(patch).getByText('@@ -1,3 +1,4 @@')).toHaveAttribute('data-kind', 'hunk')
      expect(within(patch).getByText('+++ b/src/upload/put.ts')).toHaveAttribute(
        'data-kind',
        'header'
      )
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

    it('says so for a binary file and for an empty diff', async () => {
      const user = userEvent.setup()
      seed([makeDiffFile({ path: 'logo.png', patch: null })])
      await openChanges(user)
      expect(await screen.findByTestId('changes-patch')).toHaveTextContent(
        'Binary or too large to show.'
      )

      fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files: [] }))
      await user.click(screen.getByTestId('changes-refresh'))

      expect(await screen.findByTestId('changes-empty')).toHaveTextContent(
        'No changes against origin/main.'
      )
    })
  })

  describe('selecting', () => {
    it('shows the clicked file and moves with the arrow keys', async () => {
      const user = userEvent.setup()
      seed()
      await openChanges(user)

      await user.click(await screen.findByTestId('changes-file-1'))
      expect(screen.getByTestId('changes-file-1')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('changes-patch')).toHaveTextContent('+# Uploader')

      screen.getByTestId('changes-files').focus()
      await user.keyboard('{ArrowUp}')
      expect(screen.getByTestId('changes-file-0')).toHaveAttribute('aria-selected', 'true')
      await user.keyboard('{ArrowDown}')
      expect(screen.getByTestId('changes-file-1')).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('refreshing', () => {
    it('fetches the diff again', async () => {
      const user = userEvent.setup()
      seed([put])
      await openChanges(user)
      await screen.findByTestId('changes-file-0')

      fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files: [put, readme] }))
      await user.click(screen.getByTestId('changes-refresh'))

      expect(await screen.findByTestId('changes-file-1')).toHaveTextContent('README.md')
    })
  })

  describe('quiet hours', () => {
    it('shows the refusal and no files', async () => {
      seed()
      fakeBridge.setQuietState({ inQuietHours: true, unlockedUntil: null })

      render(
        <StoreContext.Provider value={new QueStore(window.que)}>
          <ChangesView termKey={retry.id} />
        </StoreContext.Provider>
      )

      expect(await screen.findByTestId('changes-error')).toHaveTextContent('quiet hours')
      expect(screen.queryByTestId('changes-files')).not.toBeInTheDocument()
    })
  })

  describe('toggling', () => {
    it('returns to the terminals, and the loose sessions have no toggle', async () => {
      const user = userEvent.setup()
      seed()
      await openChanges(user)
      const toggle = screen.getByTestId('topbar-changes')
      expect(toggle).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByTestId('pane-0')).not.toBeInTheDocument()

      await user.click(toggle)

      expect(await screen.findByTestId('pane-0')).toBeInTheDocument()
      expect(screen.queryByTestId('changes-view')).not.toBeInTheDocument()
      await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'false'))
    })

    it('is not offered for the loose sessions', async () => {
      render(<App />)

      expect(await screen.findByTestId('pane-0')).toBeInTheDocument()
      expect(screen.queryByTestId('topbar-changes')).not.toBeInTheDocument()
    })
  })
})
