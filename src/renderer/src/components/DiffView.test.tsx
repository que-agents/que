import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { openWorkspace } from '@renderer/testing/helpers'
import {
  makeDiffFile,
  makeProject,
  makeRetryDiffFile,
  makeWorkspace,
  makeWorkspaceDiff
} from '@renderer/testing/fixtures'
import App from '../App'
import { QueStore, StoreContext } from '../store'
import DiffView from './DiffView'

const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })
const retryTs = makeDiffFile({ path: 'src/upload/retry.ts', additions: 3, deletions: 2 })
const readme = makeDiffFile({ path: 'README.md', status: 'added', additions: 4, deletions: 0 })

/** The listing with retry.ts first, and retry.ts's lines: whole-file context, a long run in withRetry. */
function seed(files = [retryTs, readme]): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files }))
  fakeBridge.seedDiffFile(makeRetryDiffFile({ workspaceId: retry.id }))
}

/** Opens the workspace and the review pane on Changes, then the first file's diff tab. */
async function openFirstDiff(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  render(<App />)
  await openWorkspace(user, retry.id)
  await user.click(screen.getByTestId('topbar-review'))
  await user.click(await screen.findByTestId('changes-file-0'))

  return within(screen.getByTestId('pane-0')).findByTestId('diff-view')
}

/** The first file's diff tab, open, and its lines once they land. */
async function openPatch(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  return within(await openFirstDiff(user)).findByTestId('diff-patch')
}

/** The app again after a restart: the workspace's diff tab comes back as it was left. */
async function reopen(
  user: ReturnType<typeof userEvent.setup>,
  first: { unmount: () => void }
): Promise<HTMLElement> {
  first.unmount()
  render(<App />)
  await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
  const view = await within(await screen.findByTestId('pane-0')).findByTestId('diff-view')
  await within(view).findByTestId('diff-patch')

  return view
}

/** Renders one diff tab on a store of its own, the tab opened (and asked for `line`) first. */
function renderTab(path: string, line?: number): void {
  const store = new QueStore(window.que)
  store.openDiff(retry.id, path, line === undefined ? {} : { line })
  render(
    <StoreContext.Provider value={store}>
      <DiffView termKey={retry.id} path={path} />
    </StoreContext.Provider>
  )
}

/** The unified row of a line of the new file, or null when it is not drawn. */
const row = (patch: HTMLElement, n: number): HTMLElement | null =>
  patch.querySelector<HTMLElement>(`[data-testid="diff-line"][data-line="${n}"]`)

/** The rows of a line that are drawn. */
const shown = (patch: HTMLElement, n: number): HTMLElement => {
  const el = row(patch, n)
  expect(el).not.toBeNull()

  return el as HTMLElement
}

// The unchanged run in withRetry: lines 6 to 33 of the file's 37.
const FOLD = '6:34'

describe('DiffView', () => {
  describe('rendering', () => {
    it('heads the lines with a toolbar: the path, its counts, and the layout and whitespace choices', async () => {
      const user = userEvent.setup()
      seed()

      const view = await openFirstDiff(user)

      expect(view).toHaveAttribute('data-path', 'src/upload/retry.ts')
      const header = within(view).getByTestId('diff-header')
      expect(header).toHaveTextContent('src/upload/retry.ts')
      expect(await within(header).findByTestId('diff-additions')).toHaveTextContent('+3')
      expect(within(header).getByTestId('diff-deletions')).toHaveTextContent('−2')
      expect(within(header).getByRole('button', { name: 'Unified' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(within(header).getByRole('button', { name: 'Split' })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
      expect(within(header).getByRole('button', { name: 'Whitespace' })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
    })

    it('numbers each line in the old and new file and signs the changed ones', async () => {
      const user = userEvent.setup()
      seed()

      const patch = await openPatch(user)

      const rows = within(patch).getAllByTestId('diff-line')

      const gutter = rows
        .slice(0, 6)
        .map((r) => [
          within(r).getByTestId('diff-line-old').textContent,
          within(r).getByTestId('diff-line-new').textContent,
          r.dataset.kind
        ])

      expect(gutter).toEqual([
        ['1', '1', 'context'],
        ['2', '2', 'context'],
        ['3', '3', 'context'],
        ['4', '', 'removed'],
        ['', '4', 'added'],
        ['', '5', 'added']
      ])
      expect(rows[3]).toHaveTextContent('4−const MAX_RETRIES = 1')
      expect(rows[4]).toHaveTextContent('4+const MAX_RETRIES = 3')
      expect(patch).not.toHaveTextContent('@@')
    })

    it('colours each token by its kind and each bracket by its depth, and marks the changed words', async () => {
      const user = userEvent.setup()
      seed()

      const patch = await openPatch(user)

      expect(within(shown(patch, 1)).getByText(/^\/\/ Retries/)).toHaveClass('tok-comment')
      expect(within(shown(patch, 2)).getByText("'./sleep'")).toHaveClass('tok-str')
      expect(within(shown(patch, 4)).getByText('const')).toHaveClass('tok-decl')
      expect(within(shown(patch, 4)).getByText('MAX_RETRIES')).toHaveClass('tok-var')
      expect(within(shown(patch, 4)).getByText('3')).toHaveClass('tok-num', 'tok-mark')
      expect(within(shown(patch, 5)).getByText('250')).not.toHaveClass('tok-mark')
      expect(within(shown(patch, 7)).getByText('withRetry')).toHaveClass('tok-fn')
      expect(within(shown(patch, 7)).getByText('Upload')).toHaveClass('tok-type')

      const brackets = within(shown(patch, 8))
        .getAllByText(/^[(){}[\]]$/)
        .map((b) => b.className)

      expect(brackets).toEqual(['tok-b2', 'tok-b3', 'tok-b1', 'tok-b1', 'tok-b3', 'tok-b2'])
      expect(within(shown(patch, 34)).getByText('await')).toHaveClass('tok-ctrl', 'tok-mark')
    })

    it('folds a long unchanged run to three lines each side, counted and labelled', async () => {
      const user = userEvent.setup()
      seed()

      const patch = await openPatch(user)

      const fold = within(patch).getByTestId(`diff-fold-${FOLD}`)
      expect(fold).toHaveTextContent('22 unchanged lines')
      expect(fold).toHaveTextContent('export async function withRetry(run: Upload) {')
      expect(within(fold).getByRole('button', { name: 'Show 20 lines above' })).toHaveTextContent(
        '↑ 20'
      )
      expect(within(fold).getByRole('button', { name: 'Show 20 lines below' })).toHaveTextContent(
        '↓ 20'
      )
      expect(within(patch).getAllByTestId('diff-line')).toHaveLength(15)
      expect(row(patch, 8)).toBeInTheDocument()
      expect(row(patch, 9)).toBeNull()
      expect(row(patch, 30)).toBeNull()
      expect(row(patch, 31)).toBeInTheDocument()
    })

    it('shows a count of the unchanged lines before a hunk when it has only the hunks', async () => {
      const user = userEvent.setup()

      const put = makeDiffFile({
        patch: [
          'diff --git a/src/upload/put.ts b/src/upload/put.ts',
          '--- a/src/upload/put.ts',
          '+++ b/src/upload/put.ts',
          '@@ -38,3 +38,3 @@ export async function put(file: Blob) {',
          '   const res = await fetch(url)',
          '-  if (!res.ok) throw new Error(res.statusText)',
          '+  if (!res.ok) throw new UploadError(res)',
          '   return res',
          ''
        ].join('\n')
      })

      seed([put])

      const patch = await openPatch(user)

      expect(patch).toHaveAttribute('data-language', 'plain')
      const gap = within(patch).getByTestId('diff-gap-0')
      expect(gap).toHaveTextContent('37 unchanged lines')
      expect(gap).toHaveTextContent('export async function put(file: Blob) {')
      expect(within(gap).queryByRole('button')).not.toBeInTheDocument()
      expect(row(patch, 38)).toHaveTextContent('3838 const res = await fetch(url)')
    })

    it('says so for a binary file and for one too large to show', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.seedDiffFile(
        makeRetryDiffFile({ workspaceId: retry.id, skipped: 'binary', hunks: [] })
      )

      const view = await openFirstDiff(user)

      expect(await within(view).findByTestId('diff-skipped')).toHaveTextContent('Binary file.')
      expect(within(view).queryByTestId('diff-patch')).not.toBeInTheDocument()

      fakeBridge.seedDiffFile(
        makeRetryDiffFile({ workspaceId: retry.id, skipped: 'too-large', hunks: [] })
      )
      fakeBridge.changeWorkspace(retry.id)

      await waitFor(() => {
        expect(within(view).getByTestId('diff-skipped')).toHaveTextContent('Too large to show.')
      })
    })

    it('says the file has no changes once it leaves the diff', async () => {
      const user = userEvent.setup()
      seed()
      const view = await openFirstDiff(user)
      fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files: [readme] }))

      await user.click(screen.getByTestId('changes-refresh'))

      expect(await within(view).findByTestId('diff-empty')).toHaveTextContent(
        'No changes in src/upload/retry.ts'
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
      await within(view).findByTestId('diff-patch')

      await user.click(screen.getByTestId('changes-commits-menu'))
      await user.click(screen.getByTestId(`changes-commit-${commit.sha}`))

      expect(await within(view).findByTestId('diff-empty')).toHaveTextContent(
        'No changes in src/upload/retry.ts'
      )
      expect(within(view).queryByTestId('diff-patch')).not.toBeInTheDocument()
      expect(fakeBridge.diffFileCalls().at(-1)).toMatchObject({ commit: commit.sha })
    })
  })

  describe('user interactions', () => {
    it('reveals twenty lines from either edge of a fold, then what is left', async () => {
      const user = userEvent.setup()
      seed()
      const patch = await openPatch(user)

      await user.click(within(patch).getByRole('button', { name: 'Show 20 lines below' }))

      expect(row(patch, 28)).toBeInTheDocument()
      expect(row(patch, 29)).toBeNull()
      const fold = within(patch).getByTestId(`diff-fold-${FOLD}`)
      expect(fold).toHaveTextContent('↑ 2↓ 22 unchanged lines')

      await user.click(within(fold).getByRole('button', { name: 'Show 2 lines above' }))

      expect(within(patch).queryByTestId(`diff-fold-${FOLD}`)).not.toBeInTheDocument()
      expect(within(patch).getAllByTestId('diff-line')).toHaveLength(37)
    })

    it('reveals the whole run from the fold count', async () => {
      const user = userEvent.setup()
      seed()
      const patch = await openPatch(user)

      await user.click(within(patch).getByRole('button', { name: '22 unchanged lines' }))

      expect(within(patch).queryByTestId(`diff-fold-${FOLD}`)).not.toBeInTheDocument()
      expect(row(patch, 20)).toHaveTextContent('1920 await step(13)')
    })

    it('lays the lines side by side: removed beside added, a filler where a side has none, context on both', async () => {
      const user = userEvent.setup()
      seed()
      const view = await openFirstDiff(user)
      await within(view).findByTestId('diff-patch')

      await user.click(within(view).getByRole('button', { name: 'Split' }))

      const patch = within(view).getByTestId('diff-patch')
      expect(patch).toHaveAttribute('data-mode', 'split')

      const rows = within(patch)
        .getAllByTestId('diff-split-row')
        .slice(0, 6)
        .map((r) =>
          [within(r).getByTestId('diff-split-old'), within(r).getByTestId('diff-split-new')].map(
            (side) => `${side.dataset.kind} ${side.textContent}`
          )
        )

      expect(rows).toEqual([
        [
          'context 1// Retries a failed upload with exponential backoff.',
          'context 1// Retries a failed upload with exponential backoff.'
        ],
        ["context 2import { sleep } from './sleep'", "context 2import { sleep } from './sleep'"],
        ['context 3', 'context 3'],
        ['removed 4−const MAX_RETRIES = 1', 'added 4+const MAX_RETRIES = 3'],
        ['filler ', 'added 5+const BACKOFF_MS = 250'],
        ['context 5', 'context 6']
      ])
      expect(within(patch).getByTestId(`diff-fold-${FOLD}`)).toHaveTextContent('22 unchanged lines')
    })

    it('remembers the layout across a restart', async () => {
      const user = userEvent.setup()
      seed()
      const first = render(<App />)
      await openWorkspace(user, retry.id)
      await user.click(screen.getByTestId('topbar-review'))
      await user.click(await screen.findByTestId('changes-file-0'))
      await user.click(await screen.findByRole('button', { name: 'Split' }))

      const view = await reopen(user, first)

      expect(within(view).getByTestId('diff-patch')).toHaveAttribute('data-mode', 'split')
      expect(within(view).getByRole('button', { name: 'Split' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    })

    it('fetches the lines again ignoring whitespace, and remembers it across a restart', async () => {
      const user = userEvent.setup()
      seed()
      const first = render(<App />)
      await openWorkspace(user, retry.id)
      await user.click(screen.getByTestId('topbar-review'))
      await user.click(await screen.findByTestId('changes-file-0'))
      await screen.findByTestId('diff-patch')
      expect(fakeBridge.diffFileCalls().at(-1)).toMatchObject({ whitespace: 'show' })

      await user.click(screen.getByRole('button', { name: 'Whitespace' }))

      await waitFor(() => {
        expect(fakeBridge.diffFileCalls().at(-1)).toEqual({
          id: retry.id,
          path: 'src/upload/retry.ts',
          whitespace: 'ignore'
        })
      })
      expect(screen.getByRole('button', { name: 'Whitespace' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )

      const view = await reopen(user, first)

      expect(within(view).getByRole('button', { name: 'Whitespace' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(fakeBridge.diffFileCalls().at(-1)).toMatchObject({ whitespace: 'ignore' })
    })

    it('unfolds and marks the line it is asked for', async () => {
      seed()
      renderTab('src/upload/retry.ts', 20)

      const patch = await screen.findByTestId('diff-patch')

      await waitFor(() => {
        expect(patch.querySelector('[data-target]')).toHaveAttribute('data-line', '20')
      })
      expect(patch.querySelector('[data-target]')).toHaveTextContent('await step(13)')
      expect(within(patch).queryByTestId(`diff-fold-${FOLD}`)).not.toBeInTheDocument()
    })

    it('marks the line asked for in the split view too', async () => {
      seed()
      localStorage.setItem('que.diffMode', 'split')
      renderTab('src/upload/retry.ts', 34)

      const patch = await screen.findByTestId('diff-patch')

      await waitFor(() => {
        expect(patch.querySelector('[data-target]')).toHaveAttribute('data-line', '34')
      })
      const target = patch.querySelector<HTMLElement>('[data-target]') as HTMLElement
      expect(within(target).getByTestId('diff-split-old')).toHaveTextContent('return run()')
      expect(within(target).getByTestId('diff-split-new')).toHaveTextContent('return await run()')
    })
  })

  describe('errors', () => {
    it('fetches the diff itself and shows the refusal during quiet hours', async () => {
      seed()
      fakeBridge.setQuietState({ inQuietHours: true, unlockedUntil: null })

      render(
        <StoreContext.Provider value={new QueStore(window.que)}>
          <DiffView termKey={retry.id} path="src/upload/retry.ts" />
        </StoreContext.Provider>
      )

      expect(await screen.findByTestId('diff-error')).toHaveTextContent('quiet hours')
      expect(screen.queryByTestId('diff-patch')).not.toBeInTheDocument()
    })
  })
})
