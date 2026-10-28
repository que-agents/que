import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import {
  makeProject,
  makePullRequest,
  makeWorkspace,
  makeWorkspaceDigest
} from '@renderer/testing/fixtures'
import App from '../App'

const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })

const waiting = makeWorkspaceDigest({
  id: 'ws_01hzx5t6y2wa',
  name: 'app-1451-token-refresh',
  status: 'needs_input',
  needsInputCount: 2,
  waitingSince: new Date(2026, 9, 14, 2, 14).toISOString(),
  pr: makePullRequest({ state: 'open' })
})

const quietOne = makeWorkspaceDigest({ id: 'ws_01hzx3k9c2qf', status: 'idle' })

const stuck = makeWorkspaceDigest({
  id: 'ws_01hzx7c4v9nd',
  name: 'app-1460-upload-limits',
  status: 'stuck',
  statusReason: 'no_heartbeat',
  workingMs: 18 * 60_000,
  commitsAhead: 0
})

async function openReport(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await user.click(await screen.findByRole('button', { name: 'Report' }))
}

describe('ReportView', () => {
  describe('rendering', () => {
    it('counts what the sessions did in one line, under the since line', async () => {
      const user = userEvent.setup()
      fakeBridge.seedDigest(quietOne)
      fakeBridge.seedDigest(waiting)
      fakeBridge.seedDigest(stuck)

      await openReport(user)

      const totals = await screen.findByTestId('report-totals')
      expect(totals).toHaveTextContent(
        /^3 sessions · 1 stuck · 1 needs input · 1 PR open · worked 1h 42m$/
      )
      expect(within(totals).getByText('1 stuck')).toHaveClass('tone-bad')
      expect(within(totals).getByText('1 needs input')).toHaveClass('tone-attention')
      expect(screen.getByTestId('report-since')).toHaveTextContent(/^since \d\d:\d\d$/)
    })

    it('shows a stuck workspace with its reason in the bad tone', async () => {
      const user = userEvent.setup()
      fakeBridge.seedDigest(stuck)

      await openReport(user)

      const row = await screen.findByTestId(`report-workspace-${stuck.id}`)
      expect(row).toHaveClass('dot-row', 'tone-bad')
      const state = within(row).getByTestId(`report-workspace-${stuck.id}-status`)
      expect(state).toHaveTextContent(/^stuck · no_heartbeat$/)
      expect(state).toHaveClass('tone-bad')
    })

    it('names the pull request state and failing checks on the link, never its URL', async () => {
      const user = userEvent.setup()
      fakeBridge.seedDigest(
        makeWorkspaceDigest({
          pr: makePullRequest({
            url: 'https://github.com/rquellh/que/pull/88',
            number: 88,
            state: 'open',
            checks: 'failing'
          })
        })
      )

      await openReport(user)

      const row = await screen.findByTestId('report-workspace-ws_01hzx3k9c2qf')
      const link = within(row).getByRole('link')
      expect(link).toHaveAttribute('href', 'https://github.com/rquellh/que/pull/88')
      expect(link).toHaveTextContent(/^#88 open · checks failing$/)
      expect(row).not.toHaveTextContent('https://')
    })

    it('says nothing ran, and nothing else, when nothing ran', async () => {
      const user = userEvent.setup()

      await openReport(user)

      expect(await screen.findByTestId('report-empty')).toHaveTextContent(
        /^nothing ran since \d\d:\d\d$/
      )
      expect(screen.getByTestId('report-totals')).toHaveTextContent(/^nothing ran since/)
      expect(screen.queryByTestId('report-workspaces')).not.toBeInTheDocument()
    })
  })

  describe('workspaces', () => {
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

      expect(await screen.findByTestId('sidebar-workspace-ws_01hzx3k9c2qf-open')).toHaveAttribute(
        'aria-current',
        'page'
      )
    })

    it('shows the empty state only when there are no workspaces', async () => {
      const user = userEvent.setup()
      fakeBridge.seedDigest(quietOne)

      await openReport(user)

      await screen.findByTestId('report-workspaces')
      expect(screen.queryByTestId('report-empty')).not.toBeInTheDocument()
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
    it('refreshes on its own when a workspace changes status', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(makeProject())
      fakeBridge.seedWorkspace(retry)
      fakeBridge.seedDigest(quietOne)
      await openReport(user)
      await screen.findByTestId(`report-workspace-${quietOne.id}`)

      fakeBridge.seedDigest(waiting)
      fakeBridge.setStatus(retry.id, 'working')

      expect(await screen.findByTestId(`report-workspace-${waiting.id}`)).toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('picks up new results on Refresh', async () => {
      const user = userEvent.setup()
      fakeBridge.seedDigest(quietOne)
      await openReport(user)
      await screen.findByTestId(`report-workspace-${quietOne.id}`)

      fakeBridge.seedDigest(stuck)
      await user.click(screen.getByRole('button', { name: 'Refresh' }))

      await waitFor(() => {
        expect(screen.getByTestId('report-totals')).toHaveTextContent(/^2 sessions · 1 stuck · /)
      })
      expect(screen.getByTestId(`report-workspace-${stuck.id}`)).toBeInTheDocument()
    })

    it('is busy and turns while the report loads, ignoring clicks, and stops at the end of a turn', async () => {
      const user = userEvent.setup()
      fakeBridge.seedDigest(quietOne)
      await openReport(user)
      await screen.findByTestId(`report-workspace-${quietOne.id}`)
      fakeBridge.seedDigest(stuck)
      fakeBridge.holdReports()
      const refresh = screen.getByRole('button', { name: 'Refresh' })
      const icon = screen.getByTestId('report-refresh-icon')

      await user.click(refresh)
      await user.click(refresh)

      expect(refresh).toHaveAttribute('aria-busy', 'true')
      expect(icon).toHaveAttribute('data-turning', 'true')

      fakeBridge.releaseReports()

      await waitFor(() => {
        expect(refresh).toHaveAttribute('aria-busy', 'false')
      })
      expect(screen.getByTestId(`report-workspace-${stuck.id}`)).toBeInTheDocument()
      expect(icon).toHaveAttribute('data-turning', 'true')
      // userEvent has no animation events: a turn ending is dispatched as the browser does.
      fireEvent.animationIteration(icon)
      expect(icon).toHaveAttribute('data-turning', 'false')
    })
  })
})
