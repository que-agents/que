import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { openWorkspace } from '@renderer/testing/helpers'
import {
  makeCommentDiffFile,
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

  describe('comment lines', () => {
    const PROJECT = 'prj_01hzw7q2m4nb'
    const upload = makeDiffFile({ path: 'src/upload/upload.ts', additions: 6, deletions: 4 })

    /** The listing with upload.ts, whose lines rewrite comments around two code changes. */
    function seedComments(ws = retry): void {
      fakeBridge.seedWorkspace(ws)
      fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: ws.id, files: [upload] }))
      fakeBridge.seedDiffFile(makeCommentDiffFile({ workspaceId: ws.id }))
    }

    /** Remembers a comment mode for the fixtures' project, as an earlier session would have. */
    function remember(mode: 'dim' | 'show' | 'fold', keepRemoved = true): void {
      localStorage.setItem('que.diffComments', JSON.stringify({ [PROJECT]: { mode, keepRemoved } }))
    }

    /** The unified row of a removed line, by its old line number. */
    const removed = (patch: HTMLElement, old: number): HTMLElement | null =>
      within(patch)
        .queryAllByTestId('diff-line')
        .find(
          (r) =>
            r.dataset.kind === 'removed' &&
            within(r).getByTestId('diff-line-old').textContent === String(old)
        ) ?? null

    it('dims changed comment lines, keeps code changes as they are, and counts them apart', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      seedComments()

      const patch = await openPatch(user)

      expect(shown(patch, 4)).toHaveAttribute('data-comment')
      expect(shown(patch, 5)).toHaveAttribute('data-comment')
      expect(removed(patch, 4)).toHaveAttribute('data-comment')
      expect(shown(patch, 6)).not.toHaveAttribute('data-comment')
      expect(removed(patch, 5)).not.toHaveAttribute('data-comment')
      expect(within(patch).queryByTestId('diff-comment-removed')).not.toBeInTheDocument()
      const header = screen.getByTestId('diff-header')
      expect(within(header).getByTestId('diff-additions')).toHaveTextContent('+2')
      expect(within(header).getByTestId('diff-deletions')).toHaveTextContent('−2')
      expect(within(header).getByTestId('diff-code-counts')).toHaveTextContent(
        /^\+2\s*−2\s*code ·$/
      )
      expect(within(header).getByTestId('diff-comment-counts')).toHaveTextContent(
        /^\+4\s*−2\s*comments$/
      )
      expect(within(header).getByTestId('diff-comments-button')).toHaveTextContent(
        'Comments dimmed ▾'
      )
    })

    it('counts a file of comments alone without a code part or a zero side', async () => {
      const user = userEvent.setup()

      const docs = makeDiffFile({
        path: 'src/upload/docs.ts',
        additions: 2,
        deletions: 0,
        commentOnly: true,
        commentAdditions: 2,
        patch: [
          'diff --git a/src/upload/docs.ts b/src/upload/docs.ts',
          '--- a/src/upload/docs.ts',
          '+++ b/src/upload/docs.ts',
          '@@ -1,1 +1,3 @@',
          '+// Backoff doubles from 250ms.',
          '+// It caps at thirty seconds.',
          ' export {}',
          ''
        ].join('\n')
      })

      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(retry)
      fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: retry.id, files: [docs] }))

      await openPatch(user)

      const header = screen.getByTestId('diff-header')
      expect(within(header).getByTestId('diff-comment-counts')).toHaveTextContent(
        /^\+2\s*comments$/
      )
      expect(within(header).queryByTestId('diff-code-counts')).not.toBeInTheDocument()
      expect(within(header).queryByTestId('diff-additions')).not.toBeInTheDocument()
    })

    it('keeps the file name whole, cutting the folders from their start, the full path its tooltip', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      seedComments()

      await openPatch(user)

      const path = screen.getByTestId('diff-path')
      expect(path).toHaveAttribute('title', 'src/upload/upload.ts')
      expect(path.querySelector('[data-truncate="start"]')).toHaveTextContent(/^src\/upload\/$/)
      expect(path.lastElementChild).toHaveTextContent(/^upload\.ts$/)
      // The path and counts are one group, the controls another, so the controls can wrap.
      expect(path.parentElement).toHaveClass('diff-head-main')
      expect(screen.getByTestId('diff-comments-button').closest('.diff-tools')).not.toBeNull()
    })

    it('offers no Comments menu and plain counts for a file without comment lines', async () => {
      const user = userEvent.setup()
      seed()

      await openPatch(user)

      const header = screen.getByTestId('diff-header')
      expect(within(header).queryByTestId('diff-comments-button')).not.toBeInTheDocument()
      expect(within(header).queryByTestId('diff-comment-counts')).not.toBeInTheDocument()
    })

    it('shows them as code from the Comments menu, remembered for the project and not another', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedProject(makeProject({ id: 'prj_01hzw9r5t7vc', name: 'billing' }))

      const invoices = makeWorkspace({
        id: 'ws_01hzx9d4f6gh',
        name: 'app-1510-invoice-retry',
        projectId: 'prj_01hzw9r5t7vc'
      })

      seedComments()
      seedComments(invoices)
      const first = render(<App />)
      await openWorkspace(user, retry.id)
      await user.click(screen.getByTestId('topbar-review'))
      await user.click(await screen.findByTestId('changes-file-0'))
      const patch = await screen.findByTestId('diff-patch')

      await user.click(screen.getByRole('button', { name: 'Comments dimmed ▾' }))

      const menu = screen.getByRole('menu', { name: 'Comment changes' })
      expect(menu).toHaveTextContent('[ Comment changes · 6 lines ]')
      expect(within(menu).getByRole('menuitemradio', { name: 'Dim default' })).toHaveAttribute(
        'aria-checked',
        'true'
      )
      expect(
        within(menu).getByRole('menuitemcheckbox', { name: /Always show removed comments/ })
      ).toHaveAttribute('aria-checked', 'true')

      await user.click(within(menu).getByRole('menuitemradio', { name: 'Show as code' }))

      expect(screen.queryByRole('menu', { name: 'Comment changes' })).not.toBeInTheDocument()
      expect(shown(patch, 4)).not.toHaveAttribute('data-comment')
      expect(screen.getByTestId('diff-comments-button')).toHaveTextContent('Comments shown ▾')

      await openWorkspace(user, invoices.id)
      await user.click(await screen.findByTestId('changes-file-0'))
      expect(await screen.findByTestId('diff-comments-button')).toHaveTextContent(
        'Comments dimmed ▾'
      )

      const view = await reopen(user, first)

      expect(within(view).getByTestId('diff-comments-button')).toHaveTextContent('Comments shown ▾')
    })

    it('folds each run of comment lines to a row that opens in place, removed comments kept and tagged', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      seedComments()
      remember('fold')

      const patch = await openPatch(user)

      const run = within(patch).getByTestId('diff-comments-c:4:6')
      expect(run).toHaveTextContent('4–5▸ 2 comment lines added')
      expect(row(patch, 4)).toBeNull()
      expect(row(patch, 5)).toBeNull()
      const kept = removed(patch, 4)
      expect(kept).toHaveAttribute('data-comment')
      expect(within(kept as HTMLElement).getByTestId('diff-comment-removed')).toHaveTextContent(
        'comment removed'
      )
      expect(within(patch).getByTestId('diff-comments-c:21:23')).toHaveTextContent(
        '19–20▸ 2 comment lines added'
      )

      await user.click(within(run).getByRole('button', { name: '▸ 2 comment lines added' }))

      expect(within(run).getByRole('button', { name: '▾ 2 comment lines added' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
      expect(shown(patch, 4)).toHaveAttribute('data-comment')
      expect(shown(patch, 5)).toBeInTheDocument()
    })

    it('folds a change of comments alone into the unchanged lines once removed comments fold too', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      seedComments()
      const patch = await openPatch(user)

      await user.click(screen.getByRole('button', { name: 'Comments dimmed ▾' }))
      await user.click(screen.getByRole('menuitemradio', { name: 'Fold one row each' }))
      await user.click(screen.getByRole('button', { name: 'Comments folded ▾' }))
      await user.click(
        screen.getByRole('menuitemcheckbox', { name: /Always show removed comments/ })
      )

      expect(within(patch).getByTestId('diff-comments-c:3:6')).toHaveTextContent(
        '4–5▸ 3 comment lines changed'
      )
      expect(within(patch).queryByTestId('diff-comment-removed')).not.toBeInTheDocument()
      const fold = within(patch).getByTestId('diff-fold-8:35')
      expect(fold).toHaveTextContent(
        /18 unchanged lines\s*·\s*▸ comment-only change: 1 removed, 2 added/
      )

      await user.click(
        within(fold).getByRole('button', { name: '▸ comment-only change: 1 removed, 2 added' })
      )

      expect(within(patch).getByTestId('diff-fold-8:20')).toHaveTextContent('6 unchanged lines')
      expect(within(patch).getByTestId('diff-fold-23:35')).toHaveTextContent('6 unchanged lines')
      expect(within(patch).getByTestId('diff-comments-c:20:23')).toHaveAttribute(
        'data-open',
        'true'
      )
      expect(shown(patch, 19)).toHaveTextContent('// Retried by withRetry,')
    })

    it('keeps a folded run as one row across both sides of the split view', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      seedComments()
      remember('fold')
      localStorage.setItem('que.diffMode', 'split')

      const patch = await openPatch(user)

      const run = within(patch).getByTestId('diff-comments-c:4:6')
      expect(run.parentElement).toHaveClass('diff-lines', 'split')

      const kept = within(patch)
        .getAllByTestId('diff-split-old')
        .find((s) => s.textContent?.includes('// Three tries.'))

      expect(kept).toHaveAttribute('data-comment')
      expect(within(kept as HTMLElement).getByText('comment removed')).toBeInTheDocument()
    })

    it('opens the folded run that holds the line a link asks for, saying why', async () => {
      fakeBridge.seedProject(makeProject())
      seedComments()
      remember('fold', false)
      const store = new QueStore(window.que)
      store.start()
      store.openDiff(retry.id, 'src/upload/upload.ts', { line: 19 })
      render(
        <StoreContext.Provider value={store}>
          <DiffView termKey={retry.id} path="src/upload/upload.ts" />
        </StoreContext.Provider>
      )

      const patch = await screen.findByTestId('diff-patch')

      await waitFor(() => {
        expect(patch.querySelector('[data-target]')).toHaveAttribute('data-line', '19')
      })
      expect(within(patch).getByTestId('diff-comments-c:20:23')).toHaveTextContent(
        '▾ comment lines · opened for a review comment'
      )
      expect(within(patch).queryByTestId('diff-fold-8:35')).not.toBeInTheDocument()
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
