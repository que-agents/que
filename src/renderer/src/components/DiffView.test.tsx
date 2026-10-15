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
import DiffView from './DiffView'

const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })
const put = makeDiffFile()
const readme = makeDiffFile({ path: 'README.md', status: 'added', additions: 4, deletions: 0 })

function seed(files = [put, readme]): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files }))
}

/** Opens the workspace and the review pane on Changes, then the first file's diff tab. */
async function openFirstDiff(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  render(<App />)
  await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
  const pane = await screen.findByTestId('pane-0')
  await waitFor(() => {
    expect(pane.dataset.activeTerm).not.toBe('')
  })
  await user.click(screen.getByTestId('topbar-review'))
  await user.click(await screen.findByTestId('changes-file-0'))
  return within(pane).findByTestId('diff-view')
}

describe('DiffView', () => {
  describe('rendering', () => {
    it('heads the patch with the path, counts and status, and marks each line', async () => {
      const user = userEvent.setup()
      seed()

      const view = await openFirstDiff(user)

      expect(view).toHaveAttribute('data-path', 'src/upload/put.ts')
      const header = within(view).getByTestId('diff-header')
      expect(header).toHaveTextContent('src/upload/put.ts · +12 −3')
      expect(header).toHaveTextContent('modified')
      const patch = within(view).getByTestId('diff-patch')
      expect(within(patch).getByText('+const retries = 3')).toHaveAttribute('data-kind', 'added')
      expect(within(patch).getByText('-const retries = 1')).toHaveAttribute('data-kind', 'removed')
      expect(within(patch).getByText('@@ -1,3 +1,4 @@')).toHaveAttribute('data-kind', 'hunk')
      expect(within(patch).getByText('+++ b/src/upload/put.ts')).toHaveAttribute(
        'data-kind',
        'header'
      )
      expect(within(patch).getByText('export {}')).toHaveAttribute('data-kind', 'context')
    })

    it('says so for a binary or too-large file', async () => {
      const user = userEvent.setup()
      seed([makeDiffFile({ path: 'assets/logo.png', status: 'added', patch: null })])

      const view = await openFirstDiff(user)

      expect(within(view).getByTestId('diff-patch')).toHaveTextContent(
        'Binary or too large to show.'
      )
    })

    it('says the file has no changes once it leaves the diff', async () => {
      const user = userEvent.setup()
      seed()
      const view = await openFirstDiff(user)
      fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files: [readme] }))

      await user.click(screen.getByTestId('changes-refresh'))

      expect(await within(view).findByTestId('diff-empty')).toHaveTextContent(
        'No changes in src/upload/put.ts'
      )
      expect(within(view).queryByTestId('diff-patch')).not.toBeInTheDocument()
    })

    it('says the file has no changes when the list narrows to a commit that left it alone', async () => {
      const user = userEvent.setup()
      seed()
      const commit = makeWorkspaceDiff().commits[1]
      fakeBridge.seedDiff(
        makeWorkspaceDiff({ workspaceId: retry.id, commit: commit.sha, files: [readme] }),
        { commit: commit.sha }
      )
      const view = await openFirstDiff(user)
      expect(within(view).getByTestId('diff-patch')).toBeInTheDocument()

      await user.click(screen.getByTestId('changes-commits-menu'))
      await user.click(screen.getByTestId(`changes-commit-${commit.sha}`))

      expect(await within(view).findByTestId('diff-empty')).toHaveTextContent(
        'No changes in src/upload/put.ts'
      )
      expect(within(view).queryByTestId('diff-patch')).not.toBeInTheDocument()
    })
  })

  describe('errors', () => {
    it('fetches the diff itself and shows the refusal during quiet hours', async () => {
      seed()
      fakeBridge.setQuietState({ inQuietHours: true, unlockedUntil: null })

      render(
        <StoreContext.Provider value={new QueStore(window.que)}>
          <DiffView termKey={retry.id} path="src/upload/put.ts" />
        </StoreContext.Provider>
      )

      expect(await screen.findByTestId('diff-error')).toHaveTextContent('quiet hours')
      expect(screen.queryByTestId('diff-patch')).not.toBeInTheDocument()
    })
  })
})
