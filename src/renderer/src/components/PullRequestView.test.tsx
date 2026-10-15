import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import {
  makePrCheck,
  makePrThreadEntry,
  makeProject,
  makePullRequest,
  makeWorkspace
} from '@renderer/testing/fixtures'
import type { PullRequest } from '../../../preload/index.d'
import App from '../App'
import { QueStore, StoreContext } from '../store'
import PullRequestView from './PullRequestView'

const NOW = Date.parse('2026-10-14T04:00:00.000Z')
const ID = 'ws_01hzx3k9c2qf'

function seed(pr: PullRequest | null = makePullRequest()): void {
  fakeBridge.seedProject(makeProject())
  fakeBridge.seedWorkspace(makeWorkspace({ id: ID, name: 'app-1432-retry-logic', pr }))
}

async function openPr(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  render(<App now={() => NOW} />)
  await user.click(await screen.findByTestId(`sidebar-workspace-${ID}-open`))
  await user.click(await screen.findByTestId('topbar-pull-request'))
  return screen.findByTestId('pr-view')
}

describe('PullRequestView', () => {
  describe('rendering', () => {
    it.each([
      ['approved', 'approved', 'tone-good'],
      ['changes_requested', 'changes requested', 'tone-bad'],
      ['review_required', 'review required', 'tone-attention']
    ] as const)('heads the view with the link and the %s decision', async (review, word, tone) => {
      const user = userEvent.setup()
      seed(makePullRequest({ state: 'open', review }))

      await openPr(user)

      const link = screen.getByTestId('pr-header-link')
      expect(link).toHaveTextContent('#41 · open · Add retry logic to the uploader')
      expect(link).toHaveAttribute('href', 'https://github.com/rquellh/que/pull/41')
      const decision = screen.getByTestId('pr-review')
      expect(decision).toHaveAttribute('data-review', review)
      expect(decision).toHaveTextContent(word)
      expect(decision).toHaveClass('status', tone)
      expect(screen.getByTestId('pr-footer-link')).toHaveTextContent('#41 on GitHub')
    })

    it('lists the checks in the order given, with state, source, duration and link', async () => {
      const user = userEvent.setup()
      seed(
        makePullRequest({
          checks: 'failing',
          checkRuns: [
            makePrCheck({
              name: 'test',
              state: 'failing',
              completedAt: '2026-10-14T01:01:21.000Z'
            }),
            makePrCheck({ name: 'lint', source: null, state: 'pending', completedAt: null }),
            makePrCheck({ name: 'build', state: 'passing' }),
            makePrCheck({ name: 'typecheck', state: 'passing' }),
            makePrCheck({ name: 'deploy', state: 'skipped', url: null, startedAt: null })
          ]
        })
      )

      await openPr(user)

      expect(screen.getByTestId('pr-checks-summary')).toHaveTextContent(
        '2 passing · 1 failing · 1 pending · 1 skipped'
      )
      const states = [0, 1, 2, 3, 4].map((i) => screen.getByTestId(`pr-check-${i}`).dataset.state)
      expect(states).toEqual(['failing', 'pending', 'passing', 'passing', 'skipped'])
      expect(screen.getByTestId('pr-check-0')).toHaveTextContent('testCI1m 21s')
      expect(screen.getByTestId('pr-check-0')).toHaveClass('tone-bad')
      expect(screen.getByTestId('pr-check-1')).toHaveTextContent(/^lint$/)
      expect(screen.getByTestId('pr-check-1')).toHaveClass('tone-busy')
      expect(screen.getByTestId('pr-check-4')).toHaveClass('tone-muted')
      const link = screen.getByTestId('pr-check-0-link')
      expect(link).toHaveAttribute('href', 'https://github.com/rquellh/que/actions/runs/1')
      expect(link).toHaveAttribute('target', '_blank')
      expect(screen.queryByTestId('pr-check-4-link')).not.toBeInTheDocument()
    })

    it('shows each kind of comment: a comment, a review with its state, a line comment', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.seedPrThread(ID, [
        makePrThreadEntry({
          author: 'reviewer',
          body: 'Two things:\nthe cap, and\n```ts\nconst retries = 3\n```\nthat is all.'
        }),
        makePrThreadEntry({
          kind: 'review',
          author: 'lead',
          state: 'approved',
          body: '',
          at: '2026-10-14T03:55:00.000Z'
        }),
        makePrThreadEntry({
          kind: 'line',
          author: 'reviewer',
          body: 'Why 3?',
          path: 'src/upload/put.ts',
          line: 12,
          hunk: '@@ -10,3 +10,4 @@\n+const retries = 3'
        })
      ])

      await openPr(user)

      const first = await screen.findByTestId('pr-comment-0')
      expect(screen.getByTestId('pr-comments-count')).toHaveTextContent('3')
      expect(first).toHaveAttribute('data-kind', 'comment')
      expect(first).toHaveTextContent('reviewer2h ago')
      expect(first.querySelector('.pr-text')?.textContent).toBe('Two things:\nthe cap, and')
      expect(first.querySelector('pre.pr-code')).toHaveTextContent('const retries = 3')

      const review = screen.getByTestId('pr-comment-1')
      expect(review).toHaveAttribute('data-kind', 'review')
      expect(within(review).getByTestId('pr-comment-1-state')).toHaveTextContent('approved')
      expect(within(review).getByTestId('pr-comment-1-state')).toHaveClass('status', 'tone-good')
      expect(review).toHaveTextContent('5m ago')

      const line = screen.getByTestId('pr-comment-2')
      expect(line).toHaveAttribute('data-kind', 'line')
      expect(within(line).getByTestId('pr-comment-2-path')).toHaveTextContent(
        'src/upload/put.ts:12'
      )
      const hunk = within(line).getByTestId('pr-comment-2-hunk')
      expect(hunk).not.toHaveAttribute('open')
      await user.click(within(hunk).getByText('Diff'))
      expect(hunk).toHaveAttribute('open')
      expect(hunk).toHaveTextContent('+const retries = 3')
    })

    it('says so when there are no checks and no comments', async () => {
      const user = userEvent.setup()
      seed()

      await openPr(user)

      expect(await screen.findByTestId('pr-checks-empty')).toHaveTextContent('No checks')
      expect(screen.getByTestId('pr-comments-empty')).toHaveTextContent('No comments yet')
    })
  })

  describe('no pull request', () => {
    it('shows the empty state and opens the create dialog', async () => {
      const user = userEvent.setup()
      seed(null)

      await openPr(user)

      expect(screen.getByTestId('pr-empty')).toHaveTextContent('No pull request yet')
      expect(screen.queryByTestId('pr-footer-link')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('pr-create'))

      expect(await screen.findByTestId('dialog-create-pr')).toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('Refresh asks the daemon to fetch again', async () => {
      const user = userEvent.setup()
      seed()
      await openPr(user)
      await waitFor(() => {
        expect(fakeBridge.prThreadCalls()).toEqual([{ id: ID, refresh: false }])
      })
      fakeBridge.seedPrThread(ID, [makePrThreadEntry({ body: 'New comment' })])

      await user.click(screen.getByTestId('pr-refresh'))

      expect(await screen.findByTestId('pr-comment-0')).toHaveTextContent('New comment')
      expect(fakeBridge.prThreadCalls().at(-1)).toEqual({ id: ID, refresh: true })
    })
  })

  describe('status updates', () => {
    it('fetches again when the pull request changes upstream', async () => {
      const user = userEvent.setup()
      const pr = makePullRequest({ updatedAt: '2026-10-14T01:00:00.000Z' })
      seed(pr)
      await openPr(user)
      await screen.findByTestId('pr-comments-empty')
      expect(fakeBridge.prThreadCalls()).toHaveLength(1)
      fakeBridge.seedPrThread(ID, [makePrThreadEntry({ body: 'Pushed a fix?' })])

      fakeBridge.setWorkspacePr(ID, { ...pr, updatedAt: '2026-10-14T02:00:00.000Z' })

      expect(await screen.findByTestId('pr-comment-0')).toHaveTextContent('Pushed a fix?')
      expect(fakeBridge.prThreadCalls()).toEqual([
        { id: ID, refresh: false },
        { id: ID, refresh: false }
      ])
    })

    it('does not fetch again for a refresh that changed nothing upstream', async () => {
      const user = userEvent.setup()
      const pr = makePullRequest({ updatedAt: '2026-10-14T01:00:00.000Z' })
      seed(pr)
      await openPr(user)
      await screen.findByTestId('pr-comments-empty')

      fakeBridge.setWorkspacePr(ID, { ...pr, checkedAt: '2026-10-14T03:00:00.000Z' })
      expect(fakeBridge.prThreadCalls()).toHaveLength(1)

      // The pull request disappearing is a change that fetches again.
      fakeBridge.setWorkspacePr(ID, null)
      expect(fakeBridge.prThreadCalls()).toHaveLength(2)
      expect(await screen.findByTestId('pr-empty')).toBeInTheDocument()
    })
  })

  describe('errors', () => {
    it('shows the refusal in one line', async () => {
      seed()
      fakeBridge.setQuietState({ inQuietHours: true, unlockedUntil: null })

      render(
        <StoreContext.Provider value={new QueStore(window.que)}>
          <PullRequestView termKey={ID} />
        </StoreContext.Provider>
      )

      expect(await screen.findByTestId('pr-error')).toHaveTextContent('quiet hours')
    })
  })
})
