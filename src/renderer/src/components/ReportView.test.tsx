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
    it('groups tasks by outcome as dot rows under one count line', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(retry)
      fakeBridge.seedTask(done)
      fakeBridge.seedTask(stuck)

      await openReport(user)

      const doneGroup = await screen.findByTestId('report-group-done')
      expect(within(doneGroup).getByRole('heading', { name: 'Done 1' })).toBeInTheDocument()
      const row = within(doneGroup).getByTestId(`report-task-${done.id}`)
      expect(row).toHaveClass('dot-row', 'tone-good')
      expect(within(row).getByText('app-1432-retry-logic')).toBeInTheDocument()
      expect(within(row).getByTestId(`report-task-${done.id}-state`)).toHaveTextContent(/^done$/)
      expect(within(row).getByText('3m · 12 turns · $0.42')).toBeInTheDocument()

      const stuckRow = within(screen.getByTestId('report-group-stuck')).getByTestId(
        `report-task-${stuck.id}`
      )

      expect(stuckRow).toHaveClass('dot-row', 'tone-bad')
      expect(within(stuckRow).getByTestId(`report-task-${stuck.id}-reason`)).toHaveTextContent(
        'no_heartbeat'
      )
      expect(screen.queryByTestId('report-group-failed')).not.toBeInTheDocument()
      expect(screen.getByTestId('report-totals')).toHaveTextContent(
        /^1 done · 1 stuck · 1 PR · 3m · \$0\.50$/
      )
      expect(screen.getByTestId('report-since')).toHaveTextContent(/^since \d\d:\d\d$/)
    })

    it('links the pull request by number, never by its URL', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(retry)
      fakeBridge.seedTask(done)

      await openReport(user)

      const row = await screen.findByTestId(`report-task-${done.id}`)
      const link = within(row).getByRole('link')
      expect(link).toHaveAttribute('href', done.prUrl)
      expect(link).toHaveTextContent(/^#88$/)
      expect(row).not.toHaveTextContent('https://')
    })

    it('names the live pull request state and failing checks on the link', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace({
        ...retry,
        pr: makePullRequest({
          url: 'https://github.com/rquellh/que/pull/88',
          number: 88,
          state: 'open',
          checks: 'failing'
        })
      })
      fakeBridge.seedTask(done)

      await openReport(user)

      const row = await screen.findByTestId(`report-task-${done.id}`)
      await waitFor(() => {
        expect(within(row).getByRole('link')).toHaveTextContent(/^#88 open · checks failing$/)
      })
    })

    it('says nothing ran, and nothing else, when nothing ran', async () => {
      const user = userEvent.setup()

      await openReport(user)

      expect(await screen.findByTestId('report-empty')).toHaveTextContent(
        /^nothing ran since \d\d:\d\d$/
      )
      expect(screen.getByTestId('report-totals')).toHaveTextContent(/^nothing ran since/)
      expect(screen.queryByTestId(/^report-group-/)).not.toBeInTheDocument()
      expect(screen.queryByTestId('report-workspaces')).not.toBeInTheDocument()
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

    it('lists each workspace in daemon order as a dot row with its state, facts and pull request', async () => {
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
      expect(row).toHaveClass('dot-row', 'tone-attention')
      const state = within(row).getByTestId(`report-workspace-${waiting.id}-status`)
      expect(state).toHaveAttribute('data-status', 'needs_input')
      expect(state).toHaveTextContent(/^needs input · since 02:14$/)
      expect(state).toHaveClass('tone-attention')
      expect(within(row).getByTestId(`report-workspace-${waiting.id}-facts`)).toHaveTextContent(
        /^worked 42m · asked for input 2× · 2 ahead$/
      )
      expect(within(row).getByRole('link')).toHaveAttribute('href', waiting.pr?.url)
      expect(within(row).getByRole('link')).toHaveTextContent(/^#41 open$/)
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

      const workspaces = await screen.findByTestId('report-workspaces')
      await user.click(within(workspaces).getByRole('button', { name: 'app-1432-retry-logic' }))

      expect(await screen.findByTestId('topbar-title')).toHaveTextContent('app-1432-retry-logic')
    })

    it('shows the empty state only when there are no tasks and no workspaces', async () => {
      const user = userEvent.setup()
      fakeBridge.seedDigest(quietOne)

      await openReport(user)

      await screen.findByTestId('report-workspaces')
      expect(screen.queryByTestId('report-empty')).not.toBeInTheDocument()
    })

    it('counts the workspaces waiting for input, leaving the zeros out', async () => {
      const user = userEvent.setup()
      fakeBridge.seedDigest(quietOne)
      fakeBridge.seedDigest(waiting)

      await openReport(user)

      const totals = await screen.findByTestId('report-totals')
      expect(totals).toHaveTextContent(/^1 needs input$/)
      expect(within(totals).getByText('1 needs input')).toHaveClass('tone-attention')
    })

    it('lists the workspaces after the task groups', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedTask(stuck)
      fakeBridge.seedDigest(quietOne)

      await openReport(user)

      await screen.findByTestId('report-workspaces')
      expect(
        screen.getAllByTestId(/^report-(group-[a-z]+|workspaces)$/).map((g) => g.dataset.testid)
      ).toEqual(['report-group-stuck', 'report-workspaces'])
    })
  })

  describe('unlocks', () => {
    it('lists each unlock with when it started and how long it lasted', async () => {
      const user = userEvent.setup()
      // Local wall-clock times, as the line prints them.
      fakeBridge.seedUnlocks([
        {
          at: new Date(2026, 9, 13, 23, 40).toISOString(),
          minutes: 20,
          why: 'check the deploy',
          endedAt: new Date(2026, 9, 14, 0, 0).toISOString()
        },
        {
          at: new Date(2026, 9, 14, 1, 12).toISOString(),
          minutes: 20,
          why: null,
          endedAt: new Date(2026, 9, 14, 1, 23).toISOString()
        }
      ])

      await openReport(user)

      expect(await screen.findByTestId('report-unlocks')).toHaveTextContent(
        /^2 unlocks · 23:40 for 20 min · 01:12 for 11 min$/
      )
    })

    it('leaves the line out when there were none', async () => {
      const user = userEvent.setup()

      await openReport(user)

      await screen.findByTestId('report-totals')
      expect(screen.queryByTestId('report-unlocks')).not.toBeInTheDocument()
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
