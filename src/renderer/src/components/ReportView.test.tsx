import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import {
  makeProject,
  makePullRequest,
  makeTask,
  makeWorkspace,
  makeWorkspaceDigest
} from '@renderer/testing/fixtures'
import App from '../App'

const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })
const done = makeTask({
  id: 'tsk_01hzy0d7w3ke',
  title: 'Add retry logic to the uploader',
  workspaceId: retry.id,
  state: 'done',
  turns: 12,
  costUsd: 0.42,
  prUrl: 'https://github.com/rquellh/que/pull/88',
  startedAt: '2026-10-14T01:00:00.000Z',
  finishedAt: '2026-10-14T01:03:05.000Z'
})
const stuck = makeTask({
  id: 'tsk_01hzy1f2g5mn',
  title: 'Document the upload limits',
  workspaceId: null,
  state: 'stuck',
  reason: 'no_heartbeat',
  turns: 3,
  costUsd: 0.08
})

async function openReport(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await user.click(await screen.findByRole('button', { name: 'Report' }))
}

describe('ReportView', () => {
  describe('rendering', () => {
    it('groups tasks by outcome with PR links, reasons and totals', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(retry)
      fakeBridge.seedTask(done)
      fakeBridge.seedTask(stuck)

      await openReport(user)

      const doneGroup = await screen.findByTestId('report-group-done')
      expect(within(doneGroup).getByRole('heading', { name: 'Done 1' })).toBeInTheDocument()
      const row = within(doneGroup).getByTestId(`report-task-${done.id}`)
      expect(within(row).getByText('app-1432-retry-logic')).toBeInTheDocument()
      expect(within(row).getByRole('link')).toHaveAttribute('href', done.prUrl)
      expect(within(row).getByText(/3m 05s · 12 turns · \$0\.42/)).toBeInTheDocument()
      const stuckGroup = screen.getByTestId('report-group-stuck')
      expect(within(stuckGroup).getByTestId(`report-task-${stuck.id}`)).toHaveTextContent(
        'no_heartbeat'
      )
      expect(screen.queryByTestId('report-group-failed')).not.toBeInTheDocument()
      expect(screen.getByTestId('report-totals')).toHaveTextContent(
        '2 tasks · 1 PRs · 15 turns · $0.50 · 3m 05s'
      )
    })

    it('says so when nothing ran', async () => {
      const user = userEvent.setup()

      await openReport(user)

      expect(await screen.findByTestId('report-empty')).toBeInTheDocument()
    })
  })

  describe('workspaces', () => {
    const waiting = makeWorkspaceDigest({
      id: 'ws_01hzx5t6y2wa',
      name: 'app-1451-token-refresh',
      status: 'needs_input',
      needsInputCount: 2,
      waitingSince: new Date(2026, 9, 14, 2, 14).toISOString(),
      pr: makePullRequest({ state: 'open' })
    })
    const quietOne = makeWorkspaceDigest({ id: 'ws_01hzx3k9c2qf', status: 'idle' })

    it('lists each workspace in daemon order with its facts and pull request', async () => {
      const user = userEvent.setup()
      fakeBridge.seedDigest(quietOne)
      fakeBridge.seedDigest(waiting)

      await openReport(user)

      const section = await screen.findByTestId('report-workspaces')
      expect(within(section).getByRole('heading', { name: 'Workspaces 2' })).toBeInTheDocument()
      expect(
        within(section)
          .getAllByTestId(/^report-workspace-ws_[a-z0-9]+$/)
          .map((r) => r.dataset.testid)
      ).toEqual([`report-workspace-${waiting.id}`, `report-workspace-${quietOne.id}`])
      const row = screen.getByTestId(`report-workspace-${waiting.id}`)
      expect(
        within(row).getByRole('button', { name: 'app-1451-token-refresh' })
      ).toBeInTheDocument()
      expect(within(row).getByText('uploader')).toBeInTheDocument()
      expect(within(row).getByTestId(`report-workspace-${waiting.id}-status`)).toHaveAttribute(
        'data-status',
        'needs_input'
      )
      expect(within(row).getByTestId(`report-workspace-${waiting.id}-facts`)).toHaveTextContent(
        'worked 42m · asked for input 2× · waiting since 02:14 · 2 commits ahead'
      )
      expect(within(row).getByRole('link')).toHaveAttribute('href', waiting.pr?.url)
      expect(
        within(screen.getByTestId(`report-workspace-${quietOne.id}`)).queryByRole('link')
      ).not.toBeInTheDocument()
    })

    it('says no work when the workspace did none', async () => {
      const user = userEvent.setup()
      fakeBridge.seedDigest(makeWorkspaceDigest({ workingMs: 0, commitsAhead: null }))

      await openReport(user)

      expect(await screen.findByTestId('report-workspace-ws_01hzx3k9c2qf-facts')).toHaveTextContent(
        /^no work in this window$/
      )
    })

    it('shows the workspace terminals when its name is clicked', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(retry)
      fakeBridge.seedDigest(quietOne)
      await openReport(user)

      await user.click(await screen.findByRole('button', { name: 'app-1432-retry-logic' }))

      expect(await screen.findByTestId('topbar-title')).toHaveTextContent('app-1432-retry-logic')
    })

    it('shows the empty state only when there are no tasks and no workspaces', async () => {
      const user = userEvent.setup()
      fakeBridge.seedDigest(quietOne)

      await openReport(user)

      await screen.findByTestId('report-workspaces')
      expect(screen.queryByTestId('report-empty')).not.toBeInTheDocument()
    })

    it('adds workspace and need-input counts to the totals', async () => {
      const user = userEvent.setup()
      fakeBridge.seedDigest(quietOne)
      fakeBridge.seedDigest(waiting)

      await openReport(user)

      expect(await screen.findByTestId('report-totals')).toHaveTextContent(
        '0 tasks · 0 PRs · 0 turns · $0.00 · 0s · 2 workspaces · 1 need input'
      )
    })
  })

  describe('unlocks', () => {
    it('says how often and how long detail was unlocked', async () => {
      const user = userEvent.setup()
      fakeBridge.seedUnlocks([
        {
          at: '2026-10-14T03:00:00.000Z',
          minutes: 20,
          why: 'check the deploy',
          endedAt: '2026-10-14T03:20:00.000Z'
        },
        {
          at: '2026-10-14T06:00:00.000Z',
          minutes: 20,
          why: null,
          endedAt: '2026-10-14T06:11:00.000Z'
        }
      ])

      await openReport(user)

      expect(await screen.findByTestId('report-unlocks')).toHaveTextContent(
        'Unlocked twice last night, 31 min total'
      )
    })

    it('says so when there were none', async () => {
      const user = userEvent.setup()

      await openReport(user)

      expect(await screen.findByTestId('report-unlocks')).toHaveTextContent('No unlocks')
    })
  })

  describe('status updates', () => {
    it('refreshes on its own when a task changes state, showing why it is stuck', async () => {
      const user = userEvent.setup()
      const running = makeTask({
        id: 'tsk_01hzy2h8j4pq',
        title: 'Fix the flaky upload test',
        workspaceId: null,
        state: 'running'
      })
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedTask(running)
      await openReport(user)
      await screen.findByTestId('report-group-running')

      fakeBridge.setTaskState(running.id, 'stuck', 'max_turns')

      expect(await screen.findByTestId(`report-task-${running.id}-reason`)).toHaveTextContent(
        'max_turns'
      )
      expect(screen.queryByTestId('report-group-running')).not.toBeInTheDocument()
    })

    it('lists the groups done, stuck, failed, paused, running, queued, then stopped', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      for (const state of [
        'stopped',
        'queued',
        'running',
        'paused',
        'failed',
        'stuck',
        'done'
      ] as const) {
        fakeBridge.seedTask(makeTask({ workspaceId: null, state }))
      }

      await openReport(user)

      await screen.findByTestId('report-group-stopped')
      expect(
        screen
          .getAllByTestId(/^report-group-/)
          .map((g) => g.dataset.testid?.replace('report-group-', ''))
      ).toEqual(['done', 'stuck', 'failed', 'paused', 'running', 'queued', 'stopped'])
    })
  })

  describe('user interactions', () => {
    it('picks up new results on Refresh', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedTask(stuck)
      await openReport(user)
      await screen.findByTestId('report-group-stuck')

      fakeBridge.setTaskState(stuck.id, 'failed', 'crashed')
      await user.click(screen.getByRole('button', { name: 'Refresh' }))

      await waitFor(() => {
        expect(screen.queryByTestId('report-group-stuck')).not.toBeInTheDocument()
      })
      expect(screen.getByTestId(`report-task-${stuck.id}`)).toHaveTextContent('crashed')
    })
  })
})
