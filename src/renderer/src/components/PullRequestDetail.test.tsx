import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { openWorkspace } from '@renderer/testing/helpers'
import {
  makeDiffFile,
  makePrCheck,
  makePrThreadEntry,
  makeProject,
  makePullRequest,
  makeWorkspace,
  makeWorkspaceDiff
} from '@renderer/testing/fixtures'
import type { PullRequest } from '../../../preload/index.d'
import App from '../App'
import { diffId, QueStore, StoreContext } from '../store'
import ReviewPane from './ReviewPane'

const NOW = Date.parse('2026-10-14T04:00:00.000Z')
const ID = 'ws_01hzx3k9c2qf'

const base = makePullRequest({
  number: 187,
  title: 'Async step-by-step workspace removal in the daemon',
  state: 'open',
  base: 'main',
  head: 'removal-daemon'
})

const app = makePullRequest({
  number: 188,
  url: 'https://github.com/rquellh/que/pull/188',
  title: 'The app reads a removal’s step from what is done',
  state: 'open',
  checks: 'failing',
  review: 'changes_requested',
  updatedAt: '2026-10-14T03:00:00.000Z',
  checkRuns: [
    makePrCheck({ name: 'lint' }),
    makePrCheck({
      name: 'e2e',
      source: 'macos',
      state: 'failing',
      url: 'https://github.com/rquellh/que/actions/runs/42',
      completedAt: '2026-10-14T01:06:12.000Z'
    }),
    makePrCheck({ name: 'test' })
  ],
  base: 'removal-daemon',
  head: 'removal-app'
})

const card = makeDiffFile({
  path: 'src/renderer/src/components/RemovalCard.tsx',
  additions: 2,
  deletions: 1,
  patch: [
    'diff --git a/src/renderer/src/components/RemovalCard.tsx b/src/renderer/src/components/RemovalCard.tsx',
    '--- a/src/renderer/src/components/RemovalCard.tsx',
    '+++ b/src/renderer/src/components/RemovalCard.tsx',
    '@@ -38,3 +38,4 @@ export function RemovalCard() {',
    '   const removal = ws.removal',
    '-  const phase = removal?.phase',
    '+  const step = currentStep(removal?.done ?? [])',
    "+  const label = step ? STEP_VERBS[step] : 'removed'",
    '   return (',
    ''
  ].join('\n')
})

const step = makeDiffFile({
  path: 'src/renderer/src/removal-step.ts',
  status: 'added',
  additions: 52,
  deletions: 0
})

const lineComment = makePrThreadEntry({
  kind: 'line',
  author: 'rquellh',
  body: 'If done is empty this reads "moving aside" too early.',
  path: card.path,
  line: 40,
  hunk: '@@ -38,3 +38,4 @@',
  at: '2026-10-14T02:00:00.000Z'
})

function seed(prs: PullRequest[] = [app, base]): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(
    makeWorkspace({
      id: ID,
      name: 'removal-app',
      branches: ['removal-daemon', 'removal-app'],
      prs,
      pr: prs[0] ?? null
    })
  )
  // The worktree's own diff holds the same file, so its Changes tab is a different one.
  fakeBridge.seedDiff(makeWorkspaceDiff({ workspaceId: ID, files: [card] }))
  fakeBridge.seedBranchDiff(
    makeWorkspaceDiff({
      workspaceId: ID,
      base: 'removal-daemon',
      head: 'removal-app',
      files: [card, step]
    }),
    { base: 'removal-daemon', head: 'removal-app' }
  )
  fakeBridge.seedPrThread(ID, {
    number: 188,
    entries: [
      makePrThreadEntry({
        author: 'rquellh',
        body: 'Otherwise looks right.',
        at: '2026-10-14T01:00:00.000Z'
      }),
      lineComment
    ],
    fetchedAt: '2026-10-14T03:10:00.000Z'
  })
}

/** A file of the pull request where only a comment changed: one line removed, two added (new 11 and 12). */
const notes = makeDiffFile({
  path: 'src/renderer/src/removal-notes.ts',
  additions: 2,
  deletions: 1,
  commentOnly: true,
  commentAdditions: 2,
  commentDeletions: 1,
  patch: [
    'diff --git a/src/renderer/src/removal-notes.ts b/src/renderer/src/removal-notes.ts',
    '--- a/src/renderer/src/removal-notes.ts',
    '+++ b/src/renderer/src/removal-notes.ts',
    '@@ -10,3 +10,4 @@ export function removalNote() {',
    '   const removal = ws.removal',
    '-  // Reads the phase.',
    '+  // Reads the step from what is done,',
    '+  // so a partial removal still reads right.',
    '   return removal',
    ''
  ].join('\n')
})

const notesComment = makePrThreadEntry({
  kind: 'line',
  author: 'rquellh',
  body: 'Say which step reads first.',
  path: notes.path,
  line: 12,
  hunk: '@@ -10,3 +10,4 @@',
  at: '2026-10-14T02:30:00.000Z'
})

/** The pull request with the comments-only file too, and a line comment on one of its lines. */
function seedNotes(): void {
  seed()
  fakeBridge.seedBranchDiff(
    makeWorkspaceDiff({
      workspaceId: ID,
      base: 'removal-daemon',
      head: 'removal-app',
      files: [notes, card, step]
    }),
    { base: 'removal-daemon', head: 'removal-app' }
  )
  fakeBridge.seedPrThread(ID, {
    number: 188,
    entries: [lineComment, notesComment],
    fetchedAt: '2026-10-14T03:10:00.000Z'
  })
}

async function openDetail(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  render(<App now={() => NOW} />)
  await openWorkspace(user, ID)
  await user.click(screen.getByRole('button', { name: 'Review pane' }))
  await user.click(screen.getByRole('tab', { name: 'Pull requests' }))
  await user.click(await screen.findByTestId('pr-row-188'))

  return screen.findByTestId('pr-view')
}

describe('PullRequestDetail', () => {
  describe('rendering', () => {
    it('heads it with the title, then its state, its number as the link, and its base', async () => {
      const user = userEvent.setup()
      seed()

      await openDetail(user)

      expect(screen.getByRole('heading', { name: app.title })).toHaveAttribute(
        'data-testid',
        'pr-title'
      )
      expect(screen.getByTestId('pr-meta')).toHaveTextContent(/^open#188 ↗into #187$/)
      expect(screen.getByTestId('pr-state')).toHaveAttribute('data-state', 'open')
      expect(screen.getByRole('link', { name: '#188 ↗' })).toHaveAttribute(
        'href',
        'https://github.com/rquellh/que/pull/188'
      )
    })

    it('holds files, checks and comments in that order', async () => {
      const user = userEvent.setup()
      seed()

      const view = await openDetail(user)

      const heads = within(view)
        .getAllByRole('button', { expanded: true })
        .filter((b) => b.classList.contains('review-fold'))

      expect(heads.map((h) => h.textContent)).toEqual([
        expect.stringMatching(/^ \[ Files \]/),
        expect.stringMatching(/^ \[ Checks \]/),
        expect.stringMatching(/^ \[ Comments \]/)
      ])
    })

    it('lists its own files against its base, which the diff asks for by branch', async () => {
      const user = userEvent.setup()
      seed()

      await openDetail(user)

      expect(await screen.findByTestId('pr-file-0')).toHaveTextContent(`M${card.path}+2 −1`)
      expect(screen.getByTestId('pr-file-1')).toHaveTextContent(`A${step.path}+52 −0`)
      expect(screen.getByTestId('pr-files-summary')).toHaveTextContent('+54 −1 · 2 · vs #187')
      expect(fakeBridge.diffCalls()).toContainEqual({
        id: ID,
        base: 'removal-daemon',
        commit: null,
        head: 'removal-app'
      })
    })

    it('lists the files where only comments changed last, under one faint line of their totals', async () => {
      const user = userEvent.setup()
      seedNotes()

      await openDetail(user)

      expect(await screen.findByTestId('pr-file-2')).toHaveAttribute('data-path', notes.path)
      expect(screen.getByTestId('pr-file-0')).toHaveAttribute('data-path', card.path)
      expect(screen.getByTestId('pr-file-1')).toHaveAttribute('data-path', step.path)
      const line = screen.getByTestId('pr-files-comment-only')
      expect(line).toHaveTextContent('comments only · 1 file · +2 −1')
      expect(line.nextElementSibling).toBe(screen.getByTestId('pr-file-2'))
      expect(screen.getByTestId('pr-files-summary')).toHaveTextContent('+56 −2 · 3 · vs #187')
    })

    it('lists the failing checks first and folds the passing ones into a line that opens', async () => {
      const user = userEvent.setup()
      seed()
      await openDetail(user)

      expect(screen.getByTestId('pr-checks-summary')).toHaveTextContent('1 failing · 2 passing')
      expect(within(screen.getByTestId('pr-checks-summary')).getByText('1 failing')).toHaveClass(
        'tone-bad'
      )
      const failing = screen.getByTestId('pr-check-0')
      expect(failing).toHaveAttribute('data-state', 'failing')
      expect(failing).toHaveTextContent('e2emacos6m 12s')
      expect(screen.getByTestId('pr-check-0-link')).toHaveAttribute(
        'href',
        'https://github.com/rquellh/que/actions/runs/42'
      )
      const passing = screen.getByTestId('pr-checks-passing')
      expect(passing).toHaveTextContent(/^2 passing · lint, test$/)
      expect(screen.queryByTestId('pr-check-1')).not.toBeInTheDocument()

      await user.click(passing)

      expect(passing).toHaveAttribute('aria-expanded', 'true')
      expect(passing).toHaveTextContent(/^2 passing$/)
      expect(screen.getByTestId('pr-check-1')).toHaveTextContent('lint')
      expect(screen.getByTestId('pr-check-2')).toHaveTextContent('test')
    })

    it('reads the review decision once, in the comments head, above the conversation', async () => {
      const user = userEvent.setup()
      seed()
      await openDetail(user)

      expect(screen.getByTestId('pr-comments-count')).toHaveTextContent('2 · changes requested')
      expect(
        within(screen.getByTestId('pr-comments')).getAllByText(/changes requested/)
      ).toHaveLength(1)
      expect(await screen.findByTestId('pr-comment-0')).toHaveTextContent('Otherwise looks right.')
      expect(screen.getByTestId('pr-comment-1')).toHaveAttribute('data-kind', 'line')
      expect(screen.getByTestId('pr-comment-1-path')).toHaveTextContent(`${card.path}:40 →`)
    })

    it('says so when there are no checks and no comments', async () => {
      const user = userEvent.setup()
      seed([
        makePullRequest({ number: 188, state: 'open', head: 'removal-app', base: 'removal-daemon' })
      ])
      fakeBridge.seedPrThread(ID, {
        number: 188,
        entries: [],
        fetchedAt: '2026-10-14T03:10:00.000Z'
      })

      await openDetail(user)

      expect(screen.getByTestId('pr-checks-empty')).toHaveTextContent('No checks')
      expect(await screen.findByTestId('pr-comments-empty')).toHaveTextContent('No comments yet')
    })
  })

  describe('folding', () => {
    it('folds a section at its head, and keeps it folded in another pull request', async () => {
      const user = userEvent.setup()
      seed()
      await openDetail(user)

      await user.click(screen.getByTestId('pr-checks-head'))

      expect(screen.getByTestId('pr-checks-head')).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByTestId('pr-checks-head').querySelector('.chevron')).not.toHaveClass('open')
      expect(screen.queryByTestId('pr-check-0')).not.toBeInTheDocument()
      expect(screen.getByTestId('pr-files-head')).toHaveAttribute('aria-expanded', 'true')

      await user.click(screen.getByRole('button', { name: 'Back to pull requests' }))
      await user.click(await screen.findByTestId('pr-row-187'))

      expect(await screen.findByTestId('pr-view')).toHaveAttribute('data-pr', '187')
      expect(screen.getByTestId('pr-checks-head')).toHaveAttribute('aria-expanded', 'false')
    })
  })

  describe('user interactions', () => {
    it('opens a file as its own diff tab beside the session tab, apart from the Changes diff of the path', async () => {
      const user = userEvent.setup()
      seed()
      await openDetail(user)
      await user.click(screen.getByRole('button', { name: 'Back to pull requests' }))
      await user.click(screen.getByRole('tab', { name: 'Changes' }))
      await user.click(await screen.findByTestId('changes-file-0'))
      await user.click(screen.getByRole('tab', { name: 'Pull requests' }))
      await user.click(await screen.findByTestId('pr-row-188'))

      await user.click(await screen.findByTestId('pr-file-0'))

      const pane = screen.getByTestId('pane-0')
      await waitFor(() => {
        expect(pane).toHaveAttribute(
          'data-active-tab',
          diffId(card.path, { head: 'removal-app', base: 'removal-daemon' })
        )
      })
      const tabs = within(pane).getAllByTestId('view-tab-diff')
      expect(tabs.map((t) => t.dataset.pr ?? '')).toEqual(['', '188'])
      expect(screen.getByTestId('pr-file-0')).toHaveAttribute('data-active', 'true')
      expect(screen.getByTestId('diff-view')).toHaveAttribute('data-pr', '188')
      expect(screen.getByTestId('diff-against')).toHaveTextContent('#188 vs #187')
    })

    it("a line comment's path:line opens the diff at that line, with the comment under it", async () => {
      const user = userEvent.setup()
      seed()
      await openDetail(user)

      await user.click(await screen.findByTestId('pr-comment-1-path'))

      const patch = await screen.findByTestId('diff-patch')
      const target = patch.querySelector<HTMLElement>('[data-target]')
      expect(target).toHaveAttribute('data-line', '40')
      expect(target).toHaveTextContent("const label = step ? STEP_VERBS[step] : 'removed'")
      const comment = screen.getByTestId(`diff-comment-${lineComment.id}`)
      expect(comment).toHaveTextContent('rquellh · 2h ago')
      expect(comment).toHaveTextContent('If done is empty this reads "moving aside" too early.')
      expect(target?.nextElementSibling).toBe(comment)
      expect(screen.getByTestId('diff-header')).toHaveTextContent('#188 vs #187')
    })

    it('keeps the comment under its line in the split view, across both sides', async () => {
      const user = userEvent.setup()
      seed()
      localStorage.setItem('que.diffMode', 'split')
      await openDetail(user)

      await user.click(await screen.findByTestId('pr-comment-1-path'))

      const patch = await screen.findByTestId('diff-patch')
      const target = patch.querySelector<HTMLElement>('[data-target]')
      expect(target).toHaveAttribute('data-testid', 'diff-split-row')
      expect(target).toHaveAttribute('data-line', '40')
      expect(within(target as HTMLElement).getByTestId('diff-split-old')).toHaveAttribute(
        'data-kind',
        'filler'
      )
      expect(target?.nextElementSibling).toBe(screen.getByTestId(`diff-comment-${lineComment.id}`))
    })

    it('under Fold, opens the run of comment lines a review comment points into and says why', async () => {
      const user = userEvent.setup()
      seedNotes()
      localStorage.setItem(
        'que.diffComments',
        JSON.stringify({ [makeProject().id]: { mode: 'fold', keepRemoved: true } })
      )
      await openDetail(user)

      await user.click(await screen.findByTestId('pr-file-2'))

      const patch = await screen.findByTestId('diff-patch')
      const run = await within(patch).findByTestId('diff-comments-c:2:4')
      expect(run).toHaveAttribute('data-open', 'true')
      expect(run).toHaveTextContent('11–12▾ comment lines · opened for a review comment')
      expect(within(run).queryByRole('button')).not.toBeInTheDocument()
      const commented = patch.querySelector<HTMLElement>('[data-line="12"]')
      expect(commented).toHaveAttribute('data-comment')
      expect(commented?.nextElementSibling).toBe(
        screen.getByTestId(`diff-comment-${notesComment.id}`)
      )
      expect(within(patch).getByTestId('diff-comment-removed')).toBeInTheDocument()
    })

    it('Refresh fetches its conversation again', async () => {
      const user = userEvent.setup()
      seed()
      await openDetail(user)

      await user.click(screen.getByTestId('pr-refresh'))

      await waitFor(() => {
        expect(fakeBridge.prThreadCalls()).toContainEqual({ id: ID, number: 188, refresh: true })
      })
    })
  })

  describe('status updates', () => {
    it('fetches the conversation again when it changes upstream, and not for another one', async () => {
      const user = userEvent.setup()
      seed()
      await openDetail(user)
      await screen.findByTestId('pr-comment-0')

      const calls = (n: number): number =>
        fakeBridge.prThreadCalls().filter((c) => c.number === n).length

      const before = calls(188)
      const other = calls(187)

      fakeBridge.setWorkspacePrs(ID, [app, { ...base, updatedAt: '2026-10-14T03:30:00.000Z' }])
      fakeBridge.setWorkspacePrs(ID, [
        { ...app, updatedAt: '2026-10-14T03:40:00.000Z' },
        { ...base, updatedAt: '2026-10-14T03:30:00.000Z' }
      ])

      await waitFor(() => {
        expect(calls(188)).toBe(before + 1)
      })
      expect(calls(187)).toBe(other)
    })
  })

  describe('caching', () => {
    it('keeps its conversation and files while it holds still, back from the list or after a worktree change', async () => {
      const user = userEvent.setup()
      seed()
      await openDetail(user)
      await screen.findByTestId('pr-file-0')
      await screen.findByTestId('pr-comment-0')
      const threads = fakeBridge.prThreadCalls().length
      const ownFiles = () => fakeBridge.diffCalls().filter((c) => c.head === 'removal-app').length
      const worktree = () => fakeBridge.diffCalls().filter((c) => c.head === undefined).length
      const files = ownFiles()
      const before = worktree()

      await user.click(screen.getByRole('button', { name: 'Back to pull requests' }))
      await user.click(await screen.findByTestId('pr-row-188'))
      expect(await screen.findByTestId('pr-comment-0')).toBeInTheDocument()
      fakeBridge.changeWorkspace(ID)

      await waitFor(() => {
        expect(worktree()).toBeGreaterThan(before)
      })
      expect(fakeBridge.prThreadCalls()).toHaveLength(threads)
      expect(ownFiles()).toBe(files)
    })
  })

  describe('errors', () => {
    it('shows the refusal in one line', async () => {
      seed()
      fakeBridge.setQuietState({ inQuietHours: true, unlockedUntil: null })
      const store = new QueStore(window.que)
      store.start()
      store.openPullRequest(ID, 188)

      render(
        <StoreContext.Provider value={store}>
          <ReviewPane termKey={ID} />
        </StoreContext.Provider>
      )

      expect(await screen.findByTestId('pr-error')).toHaveTextContent('quiet hours')
      expect(await screen.findByTestId('pr-files-error')).toHaveTextContent('quiet hours')
    })
  })
})
