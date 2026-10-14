import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject, makeQuietState, makeTask, makeWorkspace } from '@renderer/testing/fixtures'
import App from './App'
import { type ChimeKind, setChimePlayer } from './sound'

const locked = makeQuietState({
  inQuietHours: true,
  windowStart: new Date(2026, 9, 13, 19, 0).toISOString(),
  windowEnd: new Date(2026, 9, 14, 7, 0).toISOString()
})
// A fixed clock inside tonight's window, so countdowns never depend on the wall clock.
const NOW = new Date(2026, 9, 14, 2, 0).getTime()
const clock = (): number => NOW
const unlockedFor = (ms: number) => ({ unlockedUntil: new Date(NOW + ms).toISOString() })

const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })
const task = makeTask({
  id: 'tsk_01hzy0d7w3ke',
  title: 'Add retry logic to the uploader',
  workspaceId: retry.id,
  state: 'running'
})

/** Records chimes instead of playing them. */
function recordChimes(): ChimeKind[] {
  const played: ChimeKind[] = []
  setChimePlayer({ play: (kind) => played.push(kind) })
  return played
}

describe('quiet mode in the main window', () => {
  describe('rendering', () => {
    it('shows no detail and opens no terminal while quiet hours are locked', async () => {
      fakeBridge.setQuietState(locked)

      render(<App now={clock} />)

      expect(await screen.findByTestId('quiet-locked')).toHaveTextContent(
        'Quiet hours. Detail unlocks at 07:00.'
      )
      expect(screen.queryByRole('tab')).not.toBeInTheDocument()
      expect(await window.que.term.list()).toEqual([])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('status updates', () => {
    it('brings the terminals back on unlock, with the countdown and Lock now in the top bar', async () => {
      fakeBridge.setQuietState(locked)
      render(<App now={clock} />)
      await screen.findByTestId('quiet-locked')

      fakeBridge.setQuietState(unlockedFor(14 * 60_000 + 32_000))

      expect(await screen.findByRole('tab')).toBeInTheDocument()
      expect(screen.getByTestId('topbar-unlock-countdown')).toHaveTextContent(
        '🔓 unlocked · 14:32 left'
      )
      expect(screen.getByRole('button', { name: 'Lock now' })).toBeEnabled()
    })

    it('goes back to the locked view when the unlock expires', async () => {
      fakeBridge.setQuietState({ ...locked, ...unlockedFor(60_000) })
      render(<App now={clock} />)
      await screen.findByTestId('topbar-unlock-countdown')

      fakeBridge.setQuietState({ unlockedUntil: null })

      expect(await screen.findByTestId('quiet-locked')).toBeInTheDocument()
      expect(screen.queryByTestId('topbar-unlock-countdown')).not.toBeInTheDocument()
    })

    it('shows no countdown in work hours', async () => {
      render(<App now={clock} />)

      await screen.findByRole('tab')
      expect(screen.queryByTestId('topbar-unlock-countdown')).not.toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('locks early with Lock now', async () => {
      const user = userEvent.setup()
      fakeBridge.setQuietState(locked)
      await window.que.quiet.unlock({ why: 'check the deploy' })
      render(<App now={clock} />)

      await user.click(await screen.findByRole('button', { name: 'Lock now' }))

      expect(await screen.findByTestId('quiet-locked')).toBeInTheDocument()
      expect((await window.que.quiet.log())[0]).toMatchObject({
        why: 'check the deploy',
        endedAt: expect.any(String)
      })
    })
  })
})

describe('completion chime', () => {
  it('chimes when a task finishes in work hours', async () => {
    const played = recordChimes()
    fakeBridge.seedProject(makeProject())
    fakeBridge.seedWorkspace(retry)
    fakeBridge.seedTask(task)
    render(<App now={clock} />)
    await screen.findByTestId(`task-${task.id}`)

    fakeBridge.setTaskState(task.id, 'done')

    await waitFor(() => {
      expect(played).toEqual(['complete'])
    })
  })

  it('stays silent during quiet hours, even unlocked', async () => {
    const played = recordChimes()
    fakeBridge.seedProject(makeProject())
    fakeBridge.seedWorkspace(retry)
    fakeBridge.seedTask(task)
    fakeBridge.setQuietState({ ...locked, ...unlockedFor(20 * 60_000) })
    render(<App now={clock} />)
    const state = await screen.findByTestId(`task-${task.id}-state`)

    fakeBridge.setTaskState(task.id, 'done')

    await waitFor(() => {
      expect(state).toHaveAttribute('data-status', 'done')
    })
    expect(played).toEqual([])
  })

  it('chimes for a task needing input only when that is turned on', async () => {
    const played = recordChimes()
    fakeBridge.seedProject(makeProject())
    fakeBridge.seedWorkspace(retry)
    fakeBridge.seedTask(task)
    fakeBridge.setConfig({
      notifications: { chimeOnComplete: true, chimeOnNeedsInput: true, morningSummary: false }
    })
    render(<App now={clock} />)
    await screen.findByTestId(`task-${task.id}`)

    fakeBridge.setTaskState(task.id, 'stuck', 'needs_input')

    await waitFor(() => {
      expect(played).toEqual(['needs_input'])
    })
  })
})
