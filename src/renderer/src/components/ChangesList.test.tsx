import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import {
  makeDiffCommit,
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

const newest = makeDiffCommit()
const oldest = makeWorkspaceDiff().commits[1]
/** Twenty minutes after the newest fixture commit. */
const now = (): number => Date.parse('2026-10-14T14:00:00.000Z')

function seed(files = [put, readme]): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files }))
}

/** Opens the workspace, waits for its terminal, and opens the review pane on Changes. */
async function openChanges(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  render(<App now={now} />)
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
      const commits = screen.getByRole('button', { name: 'Commits 2' })
      expect(commits).toHaveAttribute('data-testid', 'changes-commits-menu')
      expect(commits).toHaveAttribute('aria-haspopup', 'menu')
      expect(commits).toHaveAttribute('aria-expanded', 'false')
      const base = screen.getByRole('button', { name: 'vs origin/main' })
      expect(base).toHaveAttribute('data-testid', 'changes-base-menu')
      expect(base).toHaveAttribute('aria-haspopup', 'menu')
      expect(base).toHaveAttribute('aria-expanded', 'false')
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

  describe('commits menu', () => {
    it('lists every commit newest first with its age, under All commits, which is the current choice', async () => {
      const user = userEvent.setup()
      seed()
      await openChanges(user)

      const button = await screen.findByTestId('changes-commits-menu')
      await user.click(button)

      expect(button).toHaveAttribute('aria-expanded', 'true')
      const menu = screen.getByRole('menu', { name: 'Commits' })
      const items = within(menu).getAllByRole('menuitemradio')
      expect(items.map((i) => i.textContent)).toEqual([
        'All commits',
        'a1b2c3d Retry uploads with backoff · 20m ago',
        'b2c3d4e Add the uploader · 50m ago'
      ])
      expect(items[0]).toHaveAttribute('data-testid', 'changes-commit-all')
      expect(items[1]).toHaveAttribute('data-testid', `changes-commit-${newest.sha}`)
      expect(items[2]).toHaveAttribute('data-testid', `changes-commit-${oldest.sha}`)
      expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    })

    it('narrows the files to the picked commit, and All commits goes back', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.seedDiff(
        makeWorkspaceDiff({ workspaceId: retry.id, commit: newest.sha, files: [readme] }),
        { commit: newest.sha }
      )
      await openChanges(user)
      await screen.findByTestId('changes-file-1')

      await user.click(screen.getByTestId('changes-commits-menu'))
      await user.click(screen.getByRole('menuitemradio', { name: /^a1b2c3d Retry uploads/ }))

      await waitFor(() => {
        expect(screen.queryByTestId('changes-file-1')).not.toBeInTheDocument()
      })
      expect(screen.getByTestId('changes-file-0')).toHaveAttribute('data-path', 'README.md')
      expect(fakeBridge.diffCalls().at(-1)).toEqual({
        id: retry.id,
        base: null,
        commit: newest.sha
      })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      const button = screen.getByTestId('changes-commits-menu')
      expect(button).toHaveTextContent('Commit a1b2c3d')
      expect(button).toHaveAttribute('title', 'Retry uploads with backoff')
      expect(screen.getByTestId('changes-summary')).toHaveTextContent(
        'Commit a1b2c3d vs origin/main'
      )

      await user.click(button)
      expect(screen.getByTestId(`changes-commit-${newest.sha}`)).toHaveAttribute(
        'aria-checked',
        'true'
      )
      await user.click(screen.getByTestId('changes-commit-all'))

      expect(await screen.findByTestId('changes-file-1')).toHaveAttribute('data-path', 'README.md')
      expect(fakeBridge.diffCalls().at(-1)).toEqual({ id: retry.id, base: null, commit: null })
      expect(screen.getByTestId('changes-summary')).toHaveTextContent('Commits 2 vs origin/main')
      expect(screen.getByTestId('changes-commits-menu')).not.toHaveAttribute('title')
    })

    it('closes on Escape', async () => {
      const user = userEvent.setup()
      seed()
      await openChanges(user)
      await user.click(await screen.findByTestId('changes-commits-menu'))
      expect(screen.getByRole('menu', { name: 'Commits' })).toBeInTheDocument()

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(screen.getByTestId('changes-commits-menu')).toHaveAttribute('aria-expanded', 'false')
    })

    it('disables its items while the daemon is unreachable', async () => {
      const user = userEvent.setup()
      seed()
      await openChanges(user)
      await screen.findByTestId('changes-commits-menu')

      fakeBridge.disconnect()
      await user.click(screen.getByTestId('changes-commits-menu'))

      const items = within(screen.getByRole('menu', { name: 'Commits' })).getAllByRole(
        'menuitemradio'
      )
      expect(items).toHaveLength(3)
      for (const item of items) expect(item).toBeDisabled()
    })
  })

  describe('base menu', () => {
    it('lists the refs to compare against with the current one chosen', async () => {
      const user = userEvent.setup()
      seed()
      await openChanges(user)

      await user.click(await screen.findByTestId('changes-base-menu'))

      const items = within(screen.getByRole('menu', { name: 'Compare against' })).getAllByRole(
        'menuitemradio'
      )
      expect(items.map((i) => i.textContent)).toEqual(['origin/main', 'main'])
      expect(items[0]).toHaveAttribute('data-testid', 'changes-base-option-0')
      expect(items[0]).toHaveAttribute('aria-checked', 'true')
      expect(items[1]).toHaveAttribute('data-testid', 'changes-base-option-1')
      expect(items[1]).toHaveAttribute('data-ref', 'main')
      expect(items[1]).toHaveAttribute('aria-checked', 'false')
    })

    it('compares against the picked ref over every commit again, and remembers it for the workspace', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.seedDiff(
        makeWorkspaceDiff({ workspaceId: retry.id, commit: newest.sha, files: [readme] }),
        { commit: newest.sha }
      )
      fakeBridge.seedDiff(
        makeWorkspaceDiff({
          workspaceId: retry.id,
          base: 'main',
          bases: ['main', 'origin/main'],
          commitsAhead: 3,
          files: [put]
        }),
        { base: 'main' }
      )
      await openChanges(user)
      await user.click(await screen.findByTestId('changes-commits-menu'))
      await user.click(screen.getByTestId(`changes-commit-${newest.sha}`))
      await waitFor(() => {
        expect(screen.getByTestId('changes-summary')).toHaveTextContent('Commit a1b2c3d')
      })

      await user.click(screen.getByTestId('changes-base-menu'))
      await user.click(screen.getByRole('menuitemradio', { name: 'main' }))

      await waitFor(() => {
        expect(screen.getByTestId('changes-summary')).toHaveTextContent('Commits 3 vs main')
      })
      expect(fakeBridge.diffCalls().at(-1)).toEqual({ id: retry.id, base: 'main', commit: null })
      expect(screen.getByTestId('changes-file-0')).toHaveAttribute('data-path', 'src/upload/put.ts')
      expect(screen.getByRole('button', { name: 'vs main' })).toHaveAttribute(
        'data-testid',
        'changes-base-menu'
      )
      expect(JSON.parse(localStorage.getItem('que.diffBases') ?? 'null')).toEqual({
        [retry.id]: 'main'
      })
    })

    it('compares against the remembered ref after a relaunch', async () => {
      seed()
      fakeBridge.seedDiff(
        makeWorkspaceDiff({ workspaceId: retry.id, base: 'main', bases: ['main', 'origin/main'] }),
        { base: 'main' }
      )
      localStorage.setItem('que.diffBases', JSON.stringify({ [retry.id]: 'main' }))

      render(
        <StoreContext.Provider value={new QueStore(window.que)}>
          <ChangesList termKey={retry.id} />
        </StoreContext.Provider>
      )

      expect(await screen.findByTestId('changes-summary')).toHaveTextContent('Commits 2 vs main')
      expect(fakeBridge.diffCalls()).toEqual([{ id: retry.id, base: 'main', commit: null }])
    })

    it('forgets a remembered ref the daemon refuses and shows the default comparison', async () => {
      seed()
      fakeBridge.failDiff(retry.id, { base: 'feature/gone' }, 'unknown ref feature/gone')
      localStorage.setItem('que.diffBases', JSON.stringify({ [retry.id]: 'feature/gone' }))

      render(
        <StoreContext.Provider value={new QueStore(window.que)}>
          <ChangesList termKey={retry.id} />
        </StoreContext.Provider>
      )

      expect(await screen.findByTestId('changes-file-1')).toHaveAttribute('data-path', 'README.md')
      expect(screen.getByTestId('changes-summary')).toHaveTextContent('Commits 2 vs origin/main')
      expect(screen.queryByTestId('changes-error')).not.toBeInTheDocument()
      expect(fakeBridge.diffCalls()).toEqual([
        { id: retry.id, base: 'feature/gone', commit: null },
        { id: retry.id, base: null, commit: null }
      ])
      expect(localStorage.getItem('que.diffBases')).toBeNull()
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
