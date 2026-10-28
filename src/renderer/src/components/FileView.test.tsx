import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import {
  makeProject,
  makeWorkspace,
  makeWorkspaceDiff,
  makeWorkspaceFile,
  makeWorkspaceFiles
} from '@renderer/testing/fixtures'
import App from '../App'
import { QueStore, StoreContext } from '../store'
import FileView from './FileView'

const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })

function seed(): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files: [] }))
  fakeBridge.seedFiles(makeWorkspaceFiles({ workspaceId: retry.id }))
}

/** Renders one file tab's view on its own. */
function renderView(path: string): void {
  render(
    <StoreContext.Provider value={new QueStore(window.que)}>
      <FileView termKey={retry.id} path={path} />
    </StoreContext.Provider>
  )
}

describe('FileView', () => {
  describe('rendering', () => {
    it('heads the text with its path and numbers every line', async () => {
      seed()
      fakeBridge.seedFile(
        makeWorkspaceFile({
          workspaceId: retry.id,
          path: 'src/index.ts',
          content: 'import { put } from "./upload/put"\n\nexport { put }\n'
        })
      )

      renderView('src/index.ts')

      const view = screen.getByTestId('file-view')
      expect(view).toHaveAttribute('data-path', 'src/index.ts')
      expect(within(view).getByTestId('file-header')).toHaveTextContent('src/index.ts')
      expect(within(view).getByTestId('file-loading')).toBeInTheDocument()
      const text = await within(view).findByTestId('file-text')
      const lines = [...text.querySelectorAll('.line')].map((l) => l.textContent)
      expect(lines).toEqual(['1import { put } from "./upload/put"', '2', '3export { put }'])
      expect(within(view).queryByTestId('file-truncated')).not.toBeInTheDocument()
    })

    it('says a binary file is binary, with its size', async () => {
      seed()
      fakeBridge.seedFile(
        makeWorkspaceFile({
          workspaceId: retry.id,
          path: 'assets/logo.png',
          content: null,
          binary: true,
          size: 20_480
        })
      )

      renderView('assets/logo.png')

      expect(await screen.findByTestId('file-binary')).toHaveTextContent('Binary file · 20 KB')
      expect(screen.queryByTestId('file-text')).not.toBeInTheDocument()
    })

    it('notes when the text was cut short', async () => {
      seed()
      fakeBridge.seedFile(
        makeWorkspaceFile({
          workspaceId: retry.id,
          path: 'dist/bundle.js',
          content: 'var a = 1\n',
          truncated: true
        })
      )

      renderView('dist/bundle.js')

      expect(await screen.findByTestId('file-truncated')).toHaveTextContent(
        'Showing the first 500,000 characters'
      )
      expect(screen.getByTestId('file-text')).toHaveTextContent('var a = 1')
    })

    it('says there is no such file once the path is gone', async () => {
      seed()

      renderView('src/removed.ts')

      expect(await screen.findByTestId('file-missing')).toHaveTextContent('No such file')
      expect(screen.queryByTestId('file-error')).not.toBeInTheDocument()
    })
  })

  describe('errors', () => {
    it('shows the refusal during quiet hours', async () => {
      seed()
      fakeBridge.seedFile(makeWorkspaceFile({ workspaceId: retry.id }))
      fakeBridge.setQuietState({ inQuietHours: true, unlockedUntil: null })

      renderView('src/index.ts')

      expect(await screen.findByTestId('file-error')).toHaveTextContent('quiet hours')
      expect(screen.queryByTestId('file-text')).not.toBeInTheDocument()
    })
  })

  describe('closing', () => {
    it('closes with Cmd+W like any tab, back to the terminal', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.seedFile(makeWorkspaceFile({ workspaceId: retry.id, path: 'package.json' }))
      render(<App />)
      await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
      const pane = await screen.findByTestId('pane-0')
      await waitFor(() => {
        expect(pane.dataset.activeTerm).not.toBe('')
      })
      const term = pane.dataset.activeTerm as string
      await user.click(screen.getByRole('button', { name: 'Show review' }))
      await user.click(screen.getByTestId('review-view-files'))
      const row = await screen.findByTestId('files-row-2')
      expect(row).toHaveAttribute('data-path', 'package.json')
      await user.click(row)
      expect(await within(pane).findByTestId('file-text')).toBeInTheDocument()

      await user.keyboard('{Meta>}w{/Meta}')

      expect(screen.queryByTestId('view-tab-file')).not.toBeInTheDocument()
      expect(screen.queryByTestId('file-view')).not.toBeInTheDocument()
      expect(pane).toHaveAttribute('data-active-term', term)
      expect(fakeBridge.getTerminal(term)).toBeDefined()
    })
  })
})
