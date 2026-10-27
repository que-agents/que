import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import {
  makeBackgroundTask,
  makeProject,
  makePullRequest,
  makeQuietState,
  makeTermInfo,
  makeUserConfig,
  makeWorkspace
} from '@renderer/testing/fixtures'
import { minutesAgo } from '@renderer/testing/helpers'
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

const uploader = makeProject()

const dotfiles = makeProject({
  id: 'prj_01hzw9d3f5kt',
  name: 'dotfiles',
  path: '/Users/dev/dotfiles'
})

const retry = makeWorkspace({
  id: 'ws_01hzx3k9c2qf',
  name: 'app-1432-retry-logic',
  status: 'working',
  lastActivityAt: minutesAgo(now, 1)
})

// Titled, as a session's summary titles it: the board reads the title, as the sidebar does.
const auth = makeWorkspace({
  id: 'ws_01hzx5t6y2wa',
  name: 'app-1451-token-refresh',
  title: 'Refresh the token on a 401',
  status: 'needs_input',
  statusAt: minutesAgo(now, 34),
  lastActivityAt: minutesAgo(now, 34)
})

const resume = makeWorkspace({
  id: 'ws_01hzx6r8s1uv',
  name: 'app-1460-upload-resume',
  status: 'stuck',
  lastActivityAt: minutesAgo(now, 50)
})

const dotfilesMain = makeWorkspace({
  id: 'ws_01hzx8w2x4yz',
  projectId: dotfiles.id,
  name: 'main',
  status: 'idle',
  lastActivityAt: minutesAgo(now, 180)
})

const shell = makeTermInfo({
  name: retry.name,
  workspaceId: retry.id,
  createdAt: minutesAgo(now, 75)
})

const dotShell = makeTermInfo({
  name: 'main',
  workspaceId: dotfilesMain.id,
  createdAt: minutesAgo(now, 200)
})

function seed(): void {
  fakeBridge.seedProject(uploader)
  fakeBridge.seedProject(dotfiles)

  for (const w of [retry, auth, resume, dotfilesMain]) fakeBridge.seedWorkspace(w)

  fakeBridge.seedTerminal(shell)
  fakeBridge.seedTerminal(dotShell)
  fakeBridge.setQuietState(quiet)
}

/** Each row's words, in order. */
function rowTexts(): (string | null)[] {
  return screen.queryAllByTestId(/^quiet-board-row-/).map((r) => r.textContent)
}

describe('QuietBoard', () => {
  describe('rendering', () => {
    it('shows the strip: the quiet hours label, the clock and until when', async () => {
      seed()

      render(<App board now={clock} />)

      expect(await screen.findByTestId('quiet-board-header')).toHaveTextContent(
        /^Quiet hours 02:00 · until 07:00$/
      )
    })

    it('counts the workspaces in one line, in order, with the zeros left out', async () => {
      seed()

      render(<App board now={clock} />)

      await waitFor(() => {
        expect(screen.getByTestId('quiet-board-counts')).toHaveTextContent(
          /^1 stuck · 1 running · 1 waiting · 1 idle$/
        )
      })
    })

    it('tones only the stuck count, mutes running, and leaves the rest faint', async () => {
      seed()

      render(<App board now={clock} />)

      const counts = await screen.findByTestId('quiet-board-counts')
      await waitFor(() => {
        expect(within(counts).getByText('1 stuck')).toHaveClass('tone-bad')
      })
      expect(within(counts).getByText('1 running')).toHaveClass('muted')
      expect(within(counts).getByText('1 waiting')).not.toHaveAttribute('class')
      expect(within(counts).getByText('1 idle')).not.toHaveAttribute('class')
    })

    it('lists stuck, working, waiting, then the rest, each with its state and last activity', async () => {
      seed()

      render(<App board now={clock} />)

      await waitFor(() => {
        expect(rowTexts()).toEqual([
          'app-1460-upload-resume uploader stuck 50m ago',
          'app-1432-retry-logic uploader working 1m ago',
          'Refresh the token on a 401 uploader waiting 34m ago',
          'main dotfiles idle 3h ago'
        ])
      })
    })

    it('names a workspace by its title where it has one, the branch otherwise', async () => {
      seed()

      render(<App board now={clock} />)

      const titled = await screen.findByTestId(`quiet-board-row-${auth.id}`)
      expect(within(titled).getByText('Refresh the token on a 401')).toBeInTheDocument()
      expect(within(titled).queryByText('app-1451-token-refresh')).not.toBeInTheDocument()
      expect(
        within(screen.getByTestId(`quiet-board-row-${retry.id}`)).getByText('app-1432-retry-logic')
      ).toBeInTheDocument()
    })

    it('reads needs input as a plain waiting, with a neutral dot and no tone on the word', async () => {
      seed()

      render(<App board now={clock} />)

      const row = await screen.findByTestId(`quiet-board-row-${auth.id}`)
      expect(row).toHaveAttribute('data-state', 'needs_input')
      expect(row).toHaveClass('tone-neutral')
      expect(within(row).getByText('waiting')).not.toHaveClass('tone-bad')
      expect(within(row).queryByText(/needs input|since/)).not.toBeInTheDocument()
      expect(
        within(screen.getByTestId(`quiet-board-row-${resume.id}`)).getByText('stuck')
      ).toHaveClass('tone-bad')
    })

    it('draws the working mark on working rows, as the sidebar does, and a still dot elsewhere', async () => {
      seed()

      render(<App board now={clock} />)

      const workspaceRow = await screen.findByTestId(`quiet-board-row-${retry.id}`)
      expect(within(workspaceRow).getByTestId(`quiet-board-mark-${retry.id}`)).toHaveClass(
        'working-mark'
      )

      const idleRow = screen.getByTestId(`quiet-board-row-${dotfilesMain.id}`)
      expect(idleRow).toHaveClass('tone-neutral')
      expect(screen.queryByTestId(`quiet-board-mark-${dotfilesMain.id}`)).not.toBeInTheDocument()
    })

    it("marks an idle row whose session still runs a shell with the sidebar's ›_, never a working one", async () => {
      seed()
      fakeBridge.setBackgroundTasks(dotfilesMain.id, [
        makeBackgroundTask({ kind: 'shell', description: 'npm run dev' })
      ])
      fakeBridge.setBackgroundTasks(retry.id, [
        makeBackgroundTask({ kind: 'subagent', description: 'Explore the uploader' })
      ])

      render(<App board now={clock} />)

      const idleRow = await screen.findByTestId(`quiet-board-row-${dotfilesMain.id}`)
      const mark = within(idleRow).getByTestId(`quiet-board-row-${dotfilesMain.id}-background`)
      expect(mark).toHaveTextContent('›_')
      expect(mark).toHaveAttribute('title', 'shell')
      expect(screen.queryByTestId(`quiet-board-row-${retry.id}-background`)).not.toBeInTheDocument()
    })

    it('carries no PR, and nothing to act on but Unlock', async () => {
      seed()
      fakeBridge.setWorkspacePrs(retry.id, [makePullRequest({ state: 'open', checks: 'failing' })])

      render(<App board now={clock} />)

      const row = await screen.findByTestId(`quiet-board-row-${retry.id}`)
      expect(row).not.toHaveTextContent(/open|✕/)
      expect(screen.getAllByRole('button')).toEqual([screen.getByTestId('quiet-board-unlock')])
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      expect(screen.queryByRole('tab')).not.toBeInTheDocument()
      expect(await window.que.term.list()).toHaveLength(2) // the board never opens a terminal
    })

    it('offers the configured unlock as its one ghost button, and nothing else in the footer', async () => {
      seed()

      render(<App board now={clock} />)

      const unlock = await screen.findByRole('button', { name: 'Unlock 20 min' })
      expect(unlock.parentElement?.textContent).toBe('Unlock 20 min')
      expect(unlock).toHaveClass('ghost')
    })
  })

  describe('manual quiet', () => {
    const manual = { ...quiet, kind: 'manual' as const }

    it('reads Quiet and Running, and offers End quiet beside Unlock', async () => {
      seed()
      fakeBridge.setQuietState(manual)

      render(<App board now={clock} />)

      expect(await screen.findByTestId('quiet-board-header')).toHaveTextContent(
        /^Quiet 02:00 · until 07:00$/
      )
      expect(screen.getByRole('region', { name: 'Quiet' })).toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'Running' })).toBeInTheDocument()
      expect(screen.getAllByRole('button')).toEqual([
        screen.getByTestId('quiet-board-unlock'),
        screen.getByTestId('quiet-board-end')
      ])
      expect(screen.getByTestId('quiet-board-end')).toHaveTextContent(/^End quiet$/)
      expect(screen.getByTestId('quiet-board-end')).toHaveClass('ghost')
    })

    it('ends the manual quiet with End quiet, and drops the button with it', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.setQuietState(manual)
      render(<App board now={clock} />)

      await user.click(await screen.findByRole('button', { name: 'End quiet' }))

      await waitFor(() => {
        expect(screen.queryByTestId('quiet-board-end')).not.toBeInTheDocument()
      })
      expect(await window.que.quiet.state()).toMatchObject({ inQuietHours: false, kind: null })
    })

    it('shows no End quiet and reads Quiet hours in a scheduled window', async () => {
      seed()

      render(<App board now={clock} />)

      expect(await screen.findByTestId('quiet-board-header')).toHaveTextContent(/^Quiet hours /)
      expect(screen.getByRole('list', { name: 'Running tonight' })).toBeInTheDocument()
      expect(screen.queryByTestId('quiet-board-end')).not.toBeInTheDocument()
    })
  })

  describe('status updates', () => {
    it('moves a workspace between counts as the daemon reports it', async () => {
      seed()
      render(<App board now={clock} />)
      await screen.findByTestId(`quiet-board-row-${retry.id}`)

      fakeBridge.setStatus(retry.id, 'idle')

      await waitFor(() => {
        expect(screen.getByTestId('quiet-board-counts')).toHaveTextContent(
          /^1 stuck · 1 waiting · 2 idle$/
        )
      })
      expect(screen.getByTestId(`quiet-board-row-${retry.id}`)).toHaveAttribute(
        'data-state',
        'idle'
      )
    })
  })

  describe('removing', () => {
    it('leaves a workspace being removed off the rows and the counts, even while its terminal lives', async () => {
      seed()
      // Marked removing on its first step, before the terminals are killed.
      fakeBridge.seedWorkspace({
        ...dotfilesMain,
        status: 'removing',
        removal: {
          plan: ['terminals', 'teardown', 'worktree'],
          since: minutesAgo(now, 0),
          done: []
        }
      })

      render(<App board now={clock} />)

      expect(await screen.findByTestId('quiet-board-counts')).toHaveTextContent(
        /^1 stuck · 1 running · 1 waiting$/
      )
      expect(screen.queryByTestId(`quiet-board-row-${dotfilesMain.id}`)).not.toBeInTheDocument()
      expect(screen.getByTestId(`quiet-board-row-${retry.id}`)).toBeInTheDocument()
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
    it('says nothing is running, in the count line and the rows', async () => {
      fakeBridge.setQuietState(quiet)

      render(<App board now={clock} />)

      expect(await screen.findByTestId('quiet-board-empty')).toHaveTextContent(/^nothing running$/)
      expect(screen.getByTestId('quiet-board-counts')).toHaveTextContent(/^nothing running$/)
    })

    it('adds when the morning summary arrives', async () => {
      fakeBridge.setConfig({
        notifications: {
          chimeOnComplete: true,
          chimeOnNeedsInput: false,
          chimeInManualQuiet: false,
          morningSummary: true
        }
      })
      fakeBridge.setQuietState(quiet)

      render(<App board now={clock} />)

      await waitFor(() => {
        expect(screen.getByTestId('quiet-board-empty')).toHaveTextContent(
          /^nothing running · summary at 07:00$/
        )
      })
    })

    it('leaves the summary out while the morning summary is off', async () => {
      fakeBridge.setConfig(makeUserConfig())
      fakeBridge.setQuietState(quiet)

      render(<App board now={clock} />)

      await waitFor(() => {
        expect(screen.getByTestId('quiet-board-empty')).toHaveTextContent(/^nothing running$/)
      })
    })
  })
})
