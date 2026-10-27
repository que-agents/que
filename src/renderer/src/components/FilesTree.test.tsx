import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import {
  makeDiffFile,
  makeProject,
  makeWorkspace,
  makeWorkspaceDiff,
  makeWorkspaceFile,
  makeWorkspaceFiles
} from '@renderer/testing/fixtures'
import App from '../App'
import { QueStore, StoreContext } from '../store'
import FilesTree from './FilesTree'

const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })

const retryTs = makeDiffFile({
  path: 'src/upload/retry.ts',
  dirty: true,
  patch:
    'diff --git a/src/upload/retry.ts b/src/upload/retry.ts\n--- a/src/upload/retry.ts\n+++ b/src/upload/retry.ts\n@@ -1 +1 @@\n-const retries = 1\n+const retries = 3\n'
})

const readme = makeDiffFile({ path: 'README.md', status: 'added', additions: 1, deletions: 0 })
const old = makeDiffFile({ path: 'src/upload/old.ts', status: 'deleted', additions: 0 })

function seed(files = [retryTs, readme, old]): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files }))
  fakeBridge.seedFiles(makeWorkspaceFiles({ workspaceId: retry.id }))
  fakeBridge.seedFile(
    makeWorkspaceFile({
      workspaceId: retry.id,
      path: 'package.json',
      content: '{\n  "name": "uploader"\n}\n'
    })
  )
}

/** Opens the workspace, waits for its terminal, and opens the review pane on Files. */
async function openFiles(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  render(<App />)
  await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
  const pane = await screen.findByTestId('pane-0')
  await waitFor(() => {
    expect(pane.dataset.activeTerm).not.toBe('')
  })
  await user.click(screen.getByTestId('topbar-review'))
  await user.click(screen.getByTestId('review-view-files'))
  await screen.findByTestId('files-row-8')

  return pane.dataset.activeTerm as string
}

/** The tree's row for a path. */
function row(path: string): HTMLElement {
  const found = screen.getAllByRole('treeitem').find((r) => r.dataset.path === path)

  if (!found) throw new Error(`no row for ${path}`)

  return found
}

/** The visible rows as `<level> <path>`. */
function outline(): string[] {
  return screen
    .getAllByRole('treeitem')
    .map((r) => `${r.getAttribute('aria-level')} ${r.dataset.path}`)
}

describe('FilesTree', () => {
  describe('rendering', () => {
    it('heads the tree with the counts and lists directories first, the changed ones open', async () => {
      const user = userEvent.setup()
      seed()

      await openFiles(user)

      const summary = screen.getByTestId('files-summary')
      expect(summary).toHaveTextContent('6 · 3 changed')
      expect(summary).toHaveAttribute('title', '6 files · 3 changed')
      expect(screen.getByTestId('files-count')).toHaveTextContent('6')
      expect(outline()).toEqual([
        '1 src',
        '2 src/upload',
        '3 src/upload/old.ts',
        '3 src/upload/retry.test.ts',
        '3 src/upload/retry.ts',
        '2 src/index.ts',
        '1 tests/e2e',
        '1 package.json',
        '1 README.md'
      ])
      expect(screen.getByTestId('files-row-0')).toHaveAttribute('data-kind', 'dir')
      expect(screen.getByTestId('files-row-0')).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByTestId('files-row-0-count')).toHaveTextContent('2')
      expect(screen.getByTestId('files-row-1-count')).toHaveTextContent('2')
      const tests = screen.getByTestId('files-row-6')
      expect(tests).toHaveTextContent(/^tests\/e2e$/)
      expect(tests).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByTestId('files-row-6-count')).not.toBeInTheDocument()
    })

    it('marks a changed file with its Changes glyph and leaves an unchanged one bare', async () => {
      const user = userEvent.setup()
      seed()

      await openFiles(user)

      expect(row('src/upload/retry.ts')).toHaveTextContent(/^retry\.tsM\*$/)
      expect(row('src/upload/retry.ts')).toHaveAttribute('data-kind', 'file')
      expect(within(row('src/upload/retry.ts')).getByTitle('modified')).toBeInTheDocument()
      expect(row('README.md')).toHaveTextContent(/^README\.mdA$/)
      expect(row('src/upload/old.ts')).toHaveTextContent(/^old\.tsD$/)
      expect(row('src/upload/retry.test.ts')).toHaveTextContent(/^retry\.test\.ts$/)
      expect(row('package.json')).toHaveTextContent(/^package\.json$/)
    })

    it('says in the tooltip when the listing was cut short', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.seedFiles(makeWorkspaceFiles({ workspaceId: retry.id, truncated: true }))

      await openFiles(user)

      expect(screen.getByTestId('files-summary')).toHaveAttribute(
        'title',
        '6 files · 3 changed · listing cut at 20,000'
      )
    })

    it('moves the marks when Changes narrows to a commit', async () => {
      const user = userEvent.setup()
      seed()
      const commit = makeWorkspaceDiff().commits[1]
      fakeBridge.seedDiff(
        makeWorkspaceDiff({ workspaceId: retry.id, commit: commit.sha, files: [readme] }),
        { commit: commit.sha }
      )
      await openFiles(user)
      await user.click(screen.getByTestId('review-view-changes'))
      await user.click(await screen.findByTestId('changes-commits-menu'))
      await user.click(screen.getByTestId(`changes-commit-${commit.sha}`))
      await waitFor(() => {
        expect(screen.getByTestId('changes-commits-menu')).toHaveTextContent(/^commit /)
      })

      await user.click(screen.getByTestId('review-view-files'))

      expect(await screen.findByTestId('files-summary')).toHaveTextContent('6 · 1 changed')
      expect(row('src/upload/retry.ts')).toHaveTextContent(/^retry\.ts$/)
      expect(row('README.md')).toHaveTextContent(/^README\.mdA$/)
    })
  })

  describe('expanding', () => {
    it('opens and closes a directory on click', async () => {
      const user = userEvent.setup()
      seed()
      await openFiles(user)

      await user.click(row('tests/e2e'))

      expect(row('tests/e2e')).toHaveAttribute('aria-expanded', 'true')
      expect(row('tests/e2e/upload.spec.ts')).toHaveAttribute('aria-level', '2')

      await user.click(row('src'))

      expect(row('src')).toHaveAttribute('aria-expanded', 'false')
      expect(outline()).toEqual([
        '1 src',
        '1 tests/e2e',
        '2 tests/e2e/upload.spec.ts',
        '1 package.json',
        '1 README.md'
      ])
    })
  })

  describe('opening', () => {
    it('opens an unchanged file as a file tab showing its text, and focuses it again on a second click', async () => {
      const user = userEvent.setup()
      seed()
      const term = await openFiles(user)

      await user.click(row('package.json'))

      const pane = screen.getByTestId('pane-0')
      const tab = within(pane).getByTestId('view-tab-file')
      expect(tab).toHaveAttribute('data-path', 'package.json')
      expect(pane).toHaveAttribute('data-active-tab', 'view:file:package.json')
      expect(await within(pane).findByTestId('file-text')).toHaveTextContent('"name": "uploader"')
      expect(row('package.json')).toHaveAttribute('data-active', 'true')

      await user.click(screen.getByTestId(`terminal-tab-${term}-select`))
      expect(row('package.json')).toHaveAttribute('data-active', 'false')

      await user.click(row('package.json'))

      expect(within(pane).getAllByTestId('view-tab-file')).toHaveLength(1)
      expect(pane).toHaveAttribute('data-active-tab', 'view:file:package.json')
      expect(row('package.json')).toHaveAttribute('data-active', 'true')
    })

    it('opens a changed file as the same diff tab Changes opens, never a second', async () => {
      const user = userEvent.setup()
      seed()
      const term = await openFiles(user)

      await user.click(row('src/upload/retry.ts'))

      const pane = screen.getByTestId('pane-0')
      expect(pane).toHaveAttribute('data-active-tab', 'view:diff:src/upload/retry.ts')
      expect(within(pane).getByTestId('diff-patch')).toHaveTextContent('+const retries = 3')
      expect(row('src/upload/retry.ts')).toHaveAttribute('data-active', 'true')
      expect(screen.queryByTestId('view-tab-file')).not.toBeInTheDocument()

      await user.click(screen.getByTestId(`terminal-tab-${term}-select`))
      await user.click(row('src/upload/retry.ts'))

      expect(within(pane).getAllByTestId('view-tab-diff')).toHaveLength(1)
      expect(pane).toHaveAttribute('data-active-tab', 'view:diff:src/upload/retry.ts')
    })

    it('opens the worktree in the editor', async () => {
      const user = userEvent.setup()
      seed()
      await openFiles(user)

      await user.click(screen.getByTestId('files-open-editor'))

      await waitFor(() => {
        expect(fakeBridge.openInEditorCalls()).toEqual([retry.path])
      })
    })
  })

  describe('keyboard', () => {
    it('moves with the arrows, closes and opens with left and right, jumps with Home and End, opens with Enter', async () => {
      const user = userEvent.setup()
      seed()
      await openFiles(user)
      const tree = screen.getByRole('tree', { name: 'Files' })
      expect(tree).toHaveAttribute('data-testid', 'files-tree')
      tree.focus()

      const cursor = (): string | undefined =>
        screen.getAllByRole('treeitem').find((r) => r.getAttribute('aria-selected') === 'true')
          ?.dataset.path

      expect(cursor()).toBe('src')
      await user.keyboard('{ArrowLeft}')
      expect(row('src')).toHaveAttribute('aria-expanded', 'false')
      await user.keyboard('{ArrowRight}')
      expect(row('src')).toHaveAttribute('aria-expanded', 'true')

      await user.keyboard('{ArrowDown}')
      expect(cursor()).toBe('src/upload')
      await user.keyboard('{ArrowLeft}')
      expect(row('src/upload')).toHaveAttribute('aria-expanded', 'false')
      await user.keyboard('{ArrowDown}')
      expect(cursor()).toBe('src/index.ts')
      await user.keyboard('{ArrowLeft}')
      expect(cursor()).toBe('src')

      await user.keyboard('{End}')
      expect(cursor()).toBe('README.md')
      await user.keyboard('{ArrowDown}')
      expect(cursor()).toBe('README.md')
      await user.keyboard('{Enter}')
      expect(screen.getByTestId('pane-0')).toHaveAttribute('data-active-tab', 'view:diff:README.md')

      await user.keyboard('{Home}{ArrowUp}')
      expect(cursor()).toBe('src')
      await user.keyboard('{Enter}')
      expect(row('src')).toHaveAttribute('aria-expanded', 'false')
    })
  })

  describe('refreshing', () => {
    it('lists again, reloads every open file tab, and keeps the directories as the user left them', async () => {
      const user = userEvent.setup()
      seed()
      await openFiles(user)
      await user.click(row('package.json'))
      expect(await screen.findByTestId('file-text')).toHaveTextContent('"name": "uploader"')
      await user.click(row('tests/e2e'))
      await user.click(row('src'))
      fakeBridge.seedFiles(
        makeWorkspaceFiles({
          workspaceId: retry.id,
          files: [...makeWorkspaceFiles().files, 'CHANGELOG.md']
        })
      )
      fakeBridge.seedFile(
        makeWorkspaceFile({ workspaceId: retry.id, path: 'package.json', content: '{}\n' })
      )

      await user.click(screen.getByTestId('files-refresh'))

      expect(await screen.findByTestId('files-row-3')).toHaveAttribute('data-path', 'CHANGELOG.md')
      expect(fakeBridge.filesCalls()).toEqual([retry.id, retry.id])
      expect(fakeBridge.readFileCalls()).toEqual([
        { id: retry.id, path: 'package.json' },
        { id: retry.id, path: 'package.json' }
      ])
      expect(fakeBridge.diffCalls()).toHaveLength(2)
      await waitFor(() => {
        expect(screen.getByTestId('file-text')).toHaveTextContent(/^1\{\}$/)
      })
      expect(row('src')).toHaveAttribute('aria-expanded', 'false')
      expect(row('tests/e2e')).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('following the worktree', () => {
    const cache = makeWorkspace({ id: 'ws_01hzx4m7d8rt', name: 'app-1440-cache-warmup' })
    const spec = makeDiffFile({ path: 'tests/e2e/upload.spec.ts', additions: 3, deletions: 0 })
    const index = makeDiffFile({ path: 'src/index.ts', additions: 1, deletions: 1 })

    it('lists again, reloads the open file tab, keeps closed directories closed, and opens one newly changed', async () => {
      const user = userEvent.setup()
      seed()
      await openFiles(user)
      await user.click(row('package.json'))
      expect(await screen.findByTestId('file-text')).toHaveTextContent('"name": "uploader"')
      await user.click(row('src'))
      expect(row('tests/e2e')).toHaveAttribute('aria-expanded', 'false')
      fakeBridge.seedFiles(
        makeWorkspaceFiles({
          workspaceId: retry.id,
          files: [...makeWorkspaceFiles().files, 'CHANGELOG.md']
        })
      )
      fakeBridge.seedDiff(
        makeWorkspaceDiff({ workspaceId: retry.id, files: [retryTs, readme, old, index, spec] })
      )
      fakeBridge.seedFile(
        makeWorkspaceFile({ workspaceId: retry.id, path: 'package.json', content: '{}\n' })
      )

      fakeBridge.changeWorkspace(retry.id)

      await waitFor(() => {
        expect(row('tests/e2e')).toHaveAttribute('aria-expanded', 'true')
      })
      await waitFor(() => {
        expect(screen.getByTestId('files-row-3')).toHaveAttribute('data-path', 'CHANGELOG.md')
      })
      await waitFor(() => {
        expect(screen.getByTestId('file-text')).toHaveTextContent(/^1\{\}$/)
      })
      expect(fakeBridge.filesCalls()).toEqual([retry.id, retry.id])
      expect(fakeBridge.diffCalls()).toHaveLength(2)
      expect(fakeBridge.readFileCalls()).toEqual([
        { id: retry.id, path: 'package.json' },
        { id: retry.id, path: 'package.json' }
      ])
      expect(screen.getByTestId('files-summary')).toHaveTextContent('7 · 5 changed')
      expect(row('src')).toHaveAttribute('aria-expanded', 'false')
      expect(outline()).toEqual([
        '1 src',
        '1 tests/e2e',
        '2 tests/e2e/upload.spec.ts',
        '1 CHANGELOG.md',
        '1 package.json',
        '1 README.md'
      ])
    })

    it('reloads an open file tab with the pane closed', async () => {
      const user = userEvent.setup()
      seed()
      await openFiles(user)
      await user.click(row('package.json'))
      expect(await screen.findByTestId('file-text')).toHaveTextContent('"name": "uploader"')
      await user.click(screen.getByTestId('topbar-review'))
      await waitFor(() => {
        expect(screen.queryByTestId('files-tree')).not.toBeInTheDocument()
      })
      fakeBridge.seedFile(
        makeWorkspaceFile({ workspaceId: retry.id, path: 'package.json', content: '{}\n' })
      )

      fakeBridge.changeWorkspace(retry.id)

      await waitFor(() => {
        expect(screen.getByTestId('file-text')).toHaveTextContent(/^1\{\}$/)
      })
      expect(fakeBridge.readFileCalls()).toHaveLength(2)
      expect(fakeBridge.filesCalls()).toEqual([retry.id, retry.id])
    })

    it('ignores a change to another workspace', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.seedWorkspace(cache)
      await openFiles(user)

      fakeBridge.changeWorkspace(cache.id)

      expect(fakeBridge.filesCalls()).toEqual([retry.id])
      expect(fakeBridge.diffCalls()).toHaveLength(1)
    })
  })

  describe('errors', () => {
    it('lists the files itself and shows the refusal during quiet hours', async () => {
      seed()
      fakeBridge.setQuietState({ inQuietHours: true, unlockedUntil: null })

      render(
        <StoreContext.Provider value={new QueStore(window.que)}>
          <FilesTree termKey={retry.id} />
        </StoreContext.Provider>
      )

      expect(await screen.findByTestId('files-error')).toHaveTextContent('quiet hours')
      expect(screen.queryByTestId('files-tree')).not.toBeInTheDocument()
    })

    it('shows why the listing failed', async () => {
      render(
        <StoreContext.Provider value={new QueStore(window.que)}>
          <FilesTree termKey="ws_gone" />
        </StoreContext.Provider>
      )

      expect(await screen.findByTestId('files-error')).toHaveTextContent('ws_gone')
      expect(screen.queryByTestId('files-tree')).not.toBeInTheDocument()
    })
  })
})
