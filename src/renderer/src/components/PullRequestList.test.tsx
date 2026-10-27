import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { openWorkspace } from '@renderer/testing/helpers'
import {
  makePrCheck,
  makePrThreadEntry,
  makeProject,
  makePullRequest,
  makeWorkspace
} from '@renderer/testing/fixtures'
import type { PullRequest } from '../../../preload/index.d'
import App from '../App'

const ID = 'ws_01hzx3k9c2qf'

// A stack of three opened from this worktree, a draft a subagent opened from its own, and an
// earlier one merged.
const stack: PullRequest[] = [
  makePullRequest({
    number: 186,
    title: 'Stale project default branch after a rename',
    state: 'merged',
    base: 'main',
    head: 'stale-default',
    additions: 41,
    deletions: 9
  }),
  makePullRequest({
    number: 187,
    title: 'Async step-by-step workspace removal in the daemon',
    state: 'open',
    checks: 'passing',
    checkRuns: [makePrCheck({ name: 'lint' }), makePrCheck({ name: 'test' })],
    base: 'main',
    head: 'removal-daemon',
    additions: 402,
    deletions: 77
  }),
  makePullRequest({
    number: 188,
    title: 'The app reads a removal’s step from what is done',
    state: 'open',
    checks: 'failing',
    checkRuns: [
      makePrCheck({ name: 'lint' }),
      makePrCheck({ name: 'e2e', state: 'failing' }),
      makePrCheck({ name: 'test' })
    ],
    base: 'removal-daemon',
    head: 'removal-app',
    additions: 214,
    deletions: 58
  }),
  makePullRequest({
    number: 189,
    title: 'The removal card reads its step from what is done',
    state: 'open',
    checks: 'pending',
    checkRuns: [makePrCheck({ name: 'lint' }), makePrCheck({ name: 'e2e', state: 'pending' })],
    base: 'removal-app',
    head: 'removal-card',
    additions: 96,
    deletions: 31
  }),
  makePullRequest({
    number: 190,
    title: 'Daemon refuses actions on a removing workspace',
    state: 'draft',
    base: 'main',
    head: 'removing-guard',
    additions: null,
    deletions: null
  })
]

function seed(prs: PullRequest[] = stack): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(
    makeWorkspace({
      id: ID,
      name: 'removal-card',
      branches: ['stale-default', 'removal-daemon', 'removal-app', 'removal-card'],
      prs,
      pr: prs[0] ?? null
    })
  )
}

async function openList(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  render(<App />)
  await openWorkspace(user, ID)
  await user.click(screen.getByRole('button', { name: 'Review pane' }))
  await user.click(screen.getByRole('tab', { name: 'Pull requests' }))

  return screen.findByTestId('pr-list')
}

const numbers = (list: HTMLElement): string[] =>
  within(list)
    .getAllByRole('button')
    .map((b) => b.dataset.testid ?? '')

describe('PullRequestList', () => {
  describe('rendering', () => {
    it('lists open and draft newest first, then merged and closed under a rule, every row aligned', async () => {
      const user = userEvent.setup()
      seed()

      await openList(user)

      expect(numbers(screen.getByTestId('pr-rows-active'))).toEqual([
        'pr-row-190',
        'pr-row-189',
        'pr-row-188',
        'pr-row-187'
      ])
      expect(screen.getByTestId('pr-settled-label')).toHaveTextContent('[ merged · closed ]')
      expect(numbers(screen.getByTestId('pr-rows-settled'))).toEqual(['pr-row-186'])
      expect(screen.getByTestId('pr-row-186')).toHaveClass('pr-row', 'settled')

      // No indent for a stack: every row is drawn the same way.
      for (const n of [190, 189, 188, 187]) {
        const row = screen.getByTestId(`pr-row-${n}`)
        expect(row).toHaveAttribute('class', 'pr-row')
        expect(row).not.toHaveAttribute('style')
      }
    })

    it('heads the list with the open count and the failing ones in the bad tone', async () => {
      const user = userEvent.setup()
      seed()

      await openList(user)

      const summary = screen.getByTestId('pr-list-summary')
      expect(screen.getByRole('heading', { name: '[ Pull requests ]' })).toBeInTheDocument()
      expect(summary).toHaveTextContent('4 open · 1 failing')
      expect(within(summary).getByText('1 failing')).toHaveClass('tone-bad')
    })

    it('reads each row: dot, number, title, then what it merges into, its checks, its lines and where it came from', async () => {
      const user = userEvent.setup()
      seed()

      await openList(user)

      const failing = screen.getByTestId('pr-row-188')
      expect(failing).toHaveTextContent('#188The app reads a removal’s step from what is done')
      expect(screen.getByTestId('pr-row-188-meta')).toHaveTextContent(
        'into #187✗ e2e · 2/3+214 −58'
      )
      expect(screen.getByTestId('pr-row-188-checks')).toHaveClass('tone-bad')
      expect(within(failing).getByTitle('open')).toHaveAttribute('data-dot', 'bad')
      expect(screen.getByTestId('pr-row-189-meta')).toHaveTextContent('into #188running 1/2+96 −31')
      expect(screen.getByTestId('pr-row-189-checks')).toHaveClass('tone-busy')
      expect(screen.getByTestId('pr-row-187-meta')).toHaveTextContent('into main✓ 2/2+402 −77')
      expect(screen.getByTestId('pr-row-187-checks')).toHaveClass('tone-good')
      // A draft from a branch this worktree never checked out: a ring, and `· subagent`.
      expect(screen.getByTestId('pr-row-190-meta')).toHaveTextContent('into maindraft· subagent')
      expect(within(screen.getByTestId('pr-row-190')).getByTitle('draft')).toHaveAttribute(
        'data-dot',
        'ring'
      )
      expect(screen.queryByTestId('pr-row-188-subagent')).not.toBeInTheDocument()
      expect(screen.getByTestId('pr-row-186-meta')).toHaveTextContent('into mainmerged+41 −9')
      expect(within(screen.getByTestId('pr-row-186')).getByTitle('merged')).toHaveAttribute(
        'data-dot',
        'muted'
      )
    })

    it('counts each conversation from the daemon, bright while it has comments since it was last opened', async () => {
      const user = userEvent.setup()
      seed(
        stack.map((pr) =>
          pr.number === 188
            ? { ...pr, comments: 2, commentedAt: '2026-10-14T03:00:00.000Z' }
            : pr.number === 187
              ? { ...pr, comments: 1, commentedAt: '2026-10-14T01:00:00.000Z' }
              : pr.number === 189
                ? { ...pr, comments: 0, commentedAt: null }
                : pr
        )
      )
      // #188 last opened before its newest comment, #187 after its only one.
      localStorage.setItem(
        'que.review',
        JSON.stringify({
          open: false,
          width: 320,
          places: {},
          seen: { [ID]: { 188: '2026-10-14T02:00:00.000Z', 187: '2026-10-14T01:00:00.000Z' } }
        })
      )

      await openList(user)

      expect(screen.getByTestId('pr-row-188-comments')).toHaveTextContent('2')
      expect(screen.getByTestId('pr-row-188-comments')).toHaveAttribute('data-new', 'true')
      expect(screen.getByTestId('pr-row-187-comments')).toHaveTextContent('1')
      expect(screen.getByTestId('pr-row-187-comments')).toHaveAttribute('data-new', 'false')
      expect(screen.getByTestId('pr-row-189-comments')).toHaveTextContent('')
      // Not counted yet: nothing shown, nothing fetched to count it.
      expect(screen.getByTestId('pr-row-190-comments')).toHaveTextContent('')
      expect(fakeBridge.prThreadCalls()).toEqual([])
    })

    it('says so while the session has opened none', async () => {
      const user = userEvent.setup()
      seed([])

      await openList(user)

      expect(screen.getByTestId('pr-empty')).toHaveTextContent(
        'No pull requests from this session yet.'
      )
      expect(screen.queryByRole('button', { name: 'Create draft PR' })).not.toBeInTheDocument()
      expect(screen.getByTestId('review-view-prs-count')).toHaveTextContent('0')
    })
  })

  describe('user interactions', () => {
    it('opens a row in place, the strip becoming its back link, and goes back to the list', async () => {
      const user = userEvent.setup()
      seed()
      await openList(user)

      await user.click(screen.getByTestId('pr-row-188'))

      const pane = screen.getByTestId('review-pane')
      expect(pane).toHaveAttribute('data-pr', '188')
      expect(screen.getByTestId('pr-view')).toHaveAttribute('data-pr', '188')
      expect(screen.queryByRole('tablist', { name: 'Review' })).not.toBeInTheDocument()
      const back = screen.getByRole('button', { name: 'Back to pull requests' })
      expect(back).toHaveTextContent('‹ #188')
      expect(fakeBridge.prThreadCalls()).toContainEqual({ id: ID, number: 188, refresh: false })

      await user.click(back)

      expect(pane).not.toHaveAttribute('data-pr')
      expect(await screen.findByTestId('pr-list')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Pull requests' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    })

    it('opening a pull request remembers its conversation as seen', async () => {
      const user = userEvent.setup()
      const at = '2026-10-14T03:00:00.000Z'
      seed(stack.map((pr) => (pr.number === 188 ? { ...pr, comments: 1, commentedAt: at } : pr)))
      fakeBridge.seedPrThread(ID, {
        number: 188,
        entries: [makePrThreadEntry({ at })],
        fetchedAt: '2026-10-14T03:10:00.000Z'
      })
      await openList(user)
      expect(screen.getByTestId('pr-row-188-comments')).toHaveAttribute('data-new', 'true')

      await user.click(screen.getByTestId('pr-row-188'))
      await screen.findByTestId('pr-comment-0')
      await user.click(screen.getByRole('button', { name: 'Back to pull requests' }))

      expect(await screen.findByTestId('pr-row-188-comments')).toHaveAttribute('data-new', 'false')
      expect(JSON.parse(localStorage.getItem('que.review') ?? '{}').seen).toEqual({
        [ID]: { 188: at }
      })
    })

    it('has no Refresh of its own: the daemon keeps the list fresh', async () => {
      const user = userEvent.setup()
      seed(stack.slice(1, 3))
      await openList(user)

      expect(screen.getByTestId('pr-refresh')).toBeDisabled()
    })
  })

  describe('status updates', () => {
    it('lists a pull request the daemon adds while the list is shown', async () => {
      const user = userEvent.setup()
      seed(stack.slice(1, 2))
      await openList(user)
      expect(screen.queryByTestId('pr-row-188')).not.toBeInTheDocument()

      fakeBridge.setWorkspacePrs(ID, stack.slice(1, 3))

      expect(await screen.findByTestId('pr-row-188')).toBeInTheDocument()
      expect(screen.getByTestId('review-view-prs-count')).toHaveTextContent('2')
    })
  })
})
