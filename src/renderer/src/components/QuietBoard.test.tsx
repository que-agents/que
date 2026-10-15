import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import {
  makeProject,
  makePullRequest,
  makeQuietState,
  makeTask,
  makeTermInfo,
  makeWorkspace
} from '@renderer/testing/fixtures'
import App from '../App'

// Tonight's window, in local time, and a fixed clock inside it: ages and
// elapsed times never depend on the wall clock or on how long a render takes.
const now = new Date(2026, 9, 14, 2, 0).getTime()
const clock = (): number => now
const windowStart = new Date(2026, 9, 13, 19, 0)
const windowEnd = new Date(2026, 9, 14, 7, 0)
const quiet = makeQuietState({
  inQuietHours: true,
  windowStart: windowStart.toISOString(),
  windowEnd: windowEnd.toISOString()
})
const ago = (minutes: number): string => new Date(now - minutes * 60_000).toISOString()

const uploader = makeProject()
const retry = makeWorkspace({
  id: 'ws_01hzx3k9c2qf',
  name: 'app-1432-retry-logic',
  status: 'working'
})
const auth = makeWorkspace({
  id: 'ws_01hzx5t6y2wa',
  name: 'app-1451-token-refresh',
  status: 'needs_input'
})
const running = makeTask({
  id: 'tsk_01hzy0d7w3ke',
  title: 'Add retry logic to the uploader',
  workspaceId: retry.id,
  state: 'running',
  startedAt: ago(42),
  lastActivityAt: ago(2),
  turns: 14,
  costUsd: 1.82,
  updatedAt: ago(2)
})
const paused = makeTask({
  id: 'tsk_01hzy1f2g5mn',
  title: 'Document the upload limits',
  workspaceId: null,
  state: 'paused',
  reason: 'rate_limit',
  pausedUntil: new Date(2026, 9, 14, 3, 0).toISOString(),
  updatedAt: ago(30)
})
const stuck = makeTask({
  id: 'tsk_01hzy2h8j4pq',
  title: 'Fix the flaky upload test',
  workspaceId: null,
  state: 'stuck',
  reason: 'no_heartbeat',
  updatedAt: ago(60)
})
const doneTonight = makeTask({ id: 'tsk_01hzy3k2l6rs', state: 'done', updatedAt: ago(90) })
const doneYesterday = makeTask({ id: 'tsk_01hzy4m5n7tu', state: 'done', updatedAt: ago(26 * 60) })
const shell = makeTermInfo({ name: retry.name, workspaceId: retry.id, createdAt: ago(75) })

function seed(): void {
  fakeBridge.seedProject(uploader)
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedWorkspace(auth)
  for (const t of [running, paused, stuck, doneTonight, doneYesterday]) fakeBridge.seedTask(t)
  fakeBridge.seedTerminal(shell)
  fakeBridge.setQuietState(quiet)
}

describe('QuietBoard', () => {
  describe('rendering', () => {
    it('answers "running and not stuck?" with counts since the window started', async () => {
      seed()

      render(<App board now={clock} />)

      const header = await screen.findByTestId('quiet-board-header')
      expect(header).toHaveTextContent(/^que · quiet hours · 02:00 · detail unlocks at 07:00$/)
      await waitFor(() => {
        expect(screen.getByTestId('quiet-board-counts')).toHaveTextContent(
          '1 running · 1 paused (limit resets 03:00) · 1 stuck · 1 done'
        )
      })
      expect(screen.getByTestId('quiet-board-counts')).toHaveTextContent(
        '2 workspaces · 1 working · 1 need input · 0 stuck'
      )
    })

    it('shows a row per live task and per workspace that is working, waiting, stuck or has a live terminal, and nothing else to act on', async () => {
      seed()

      render(<App board now={clock} />)

      const row = await screen.findByTestId(`quiet-board-row-${running.id}`)
      expect(
        within(row)
          .getAllByRole('cell')
          .map((c) => c.textContent)
      ).toEqual([
        'Add retry logic to the uploader',
        'uploader',
        'running',
        '-',
        '42m 00s',
        '2m ago',
        '14',
        '$1.82'
      ])
      expect(screen.getByTestId(`quiet-board-row-${paused.id}`)).toHaveAttribute(
        'data-state',
        'paused'
      )
      const ws = screen.getByTestId(`quiet-board-row-${retry.id}`)
      expect(
        within(ws)
          .getAllByRole('cell')
          .map((c) => c.textContent)
      ).toEqual(['app-1432-retry-logic', 'uploader', 'working', '-', '1h 15m', '-', '-', '-'])
      expect(screen.getByTestId(`quiet-board-row-${auth.id}`)).toBeInTheDocument()
      expect(screen.queryByTestId(`quiet-board-row-${stuck.id}`)).not.toBeInTheDocument()
      expect(screen.getAllByRole('button')).toEqual([screen.getByTestId('quiet-board-unlock')])
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      expect(screen.queryByRole('tab')).not.toBeInTheDocument()
      expect(await window.que.term.list()).toHaveLength(1) // the board never opens a terminal
    })
  })

  describe('workspaces without a terminal', () => {
    it('lists a waiting workspace first, with since when it needs input', async () => {
      seed()
      fakeBridge.seedWorkspace({ ...auth, statusAt: new Date(2026, 9, 14, 1, 30).toISOString() })

      render(<App board now={clock} />)

      const first = (await screen.findAllByTestId(/^quiet-board-row-/))[0]
      expect(first).toHaveAttribute('data-testid', `quiet-board-row-${auth.id}`)
      expect(
        within(first)
          .getAllByRole('cell')
          .map((c) => c.textContent)
      ).toEqual([
        'app-1451-token-refresh',
        'uploader',
        'needs input · since 01:30',
        '-',
        '-',
        '-',
        '-',
        '-'
      ])
    })
  })

  describe('pull requests', () => {
    it('shows the PR state, marked when checks fail, and a dash without one', async () => {
      seed()
      fakeBridge.setWorkspacePr(retry.id, makePullRequest({ state: 'open', checks: 'failing' }))

      render(<App board now={clock} />)

      const ws = await screen.findByTestId(`quiet-board-row-${retry.id}`)
      await waitFor(() => {
        expect(within(ws).getAllByRole('cell')[3]).toHaveTextContent('open ✕')
      })
      fakeBridge.setWorkspacePr(retry.id, null)
      await waitFor(() => {
        expect(within(ws).getAllByRole('cell')[3]).toHaveTextContent(/^-$/)
      })
    })
  })

  describe('status updates', () => {
    it('moves a task between counts as the daemon reports it', async () => {
      seed()
      render(<App board now={clock} />)
      await screen.findByTestId(`quiet-board-row-${running.id}`)

      fakeBridge.setTaskState(running.id, 'done')

      await waitFor(() => {
        expect(screen.getByTestId('quiet-board-counts')).toHaveTextContent(
          '0 running · 1 paused (limit resets 03:00) · 1 stuck · 2 done'
        )
      })
      expect(screen.queryByTestId(`quiet-board-row-${running.id}`)).not.toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('asks the daemon for the configured unlock', async () => {
      const user = userEvent.setup()
      seed()
      render(<App board now={clock} />)

      await user.click(await screen.findByRole('button', { name: 'Unlock 20 min' }))

      await waitFor(() => {
        expect(fakeBridge.unlockCalls()).toEqual([{}])
      })
    })
  })

  describe('empty state', () => {
    it('says nothing is running', async () => {
      fakeBridge.setQuietState(quiet)

      render(<App board now={clock} />)

      expect(await screen.findByTestId('quiet-board-empty')).toHaveTextContent('Nothing running.')
      expect(screen.getByTestId('quiet-board-counts')).toHaveTextContent(
        '0 running · 0 paused · 0 stuck · 0 done'
      )
    })
  })
})
