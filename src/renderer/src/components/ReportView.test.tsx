import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject, makeTask, makeWorkspace } from '@renderer/testing/fixtures'
import App from '../App'

const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'ha-1432-retry-logic' })
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
      expect(within(row).getByText('ha-1432-retry-logic')).toBeInTheDocument()
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
