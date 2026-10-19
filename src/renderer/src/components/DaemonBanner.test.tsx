import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject, makeTermInfo, makeWorkspace } from '@renderer/testing/fixtures'
import App from '../App'

const project = makeProject({ id: 'prj_01hzx2a7k4mn', name: 'uploader' })

const retry = makeWorkspace({
  id: 'ws_01hzx3k9c2qf',
  projectId: project.id,
  name: 'app-1432-retry-logic',
  status: 'working'
})

const docs = makeWorkspace({
  id: 'ws_01hzx4m1p8rt',
  projectId: project.id,
  name: 'app-1440-docs',
  status: 'idle'
})

const UPDATE =
  'que was updated. The background service is still running the previous build. Update it to pick up the changes; your terminals keep running.'

/** A daemon still running the build before this app's. */
const STALE = { buildId: '8c41e07d92aa', expectedBuildId: '3f9a2c71b0de', stale: true }

const claude = makeTermInfo({ name: 'claude', workspaceId: retry.id })
const docsShell = makeTermInfo({ name: 'zsh', workspaceId: docs.id })
const homeShell = makeTermInfo({ name: 'zsh', cwd: '/Users/dev' })

function seed(): void {
  fakeBridge.seedProject(project)
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedWorkspace(docs)
  fakeBridge.seedTerminal(claude)
  fakeBridge.seedTerminal(docsShell)
  fakeBridge.seedTerminal(homeShell)
}

describe('DaemonBanner', () => {
  describe('rendering', () => {
    it('says the background service runs the previous build and offers to update it in place', async () => {
      seed()
      fakeBridge.setDaemon(STALE)

      render(<App />)

      expect(await screen.findByTestId('app-daemon-banner')).toHaveTextContent(UPDATE)
      expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
      expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('updates the daemon in place on the click, then goes away with the stale build', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.setDaemon(STALE)
      render(<App />)

      await user.click(await screen.findByRole('button', { name: 'Update' }))

      await waitFor(() => {
        expect(screen.queryByTestId('app-daemon-banner')).not.toBeInTheDocument()
      })
      expect(fakeBridge.upgradeCalls()).toBe(1)
      expect(fakeBridge.restartCalls()).toBe(0)
    })

    it('says the update is under way and takes no second click until it answers', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.setDaemon(STALE)
      fakeBridge.holdUpgrade()
      render(<App />)

      await user.click(await screen.findByRole('button', { name: 'Update' }))

      expect(await screen.findByRole('button', { name: 'Updating…' })).toBeDisabled()
      fakeBridge.releaseUpgrade()
      await waitFor(() => {
        expect(screen.queryByTestId('app-daemon-banner')).not.toBeInTheDocument()
      })
      expect(fakeBridge.upgradeCalls()).toBe(1)
    })

    it('keeps every terminal through the update: each attaches again with its id and none reads exited', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.setDaemon(STALE)
      render(<App />)
      await user.click(await screen.findByTestId(`sidebar-workspace-${retry.id}-open`))
      await screen.findByTestId(`terminal-tab-${claude.id}`)
      await waitFor(() => {
        expect(fakeBridge.attachCalls()).toContain(claude.id)
      })
      const attached = fakeBridge.attachCalls().filter((id) => id === claude.id).length

      await user.click(screen.getByRole('button', { name: 'Update' }))

      await waitFor(() => {
        expect(screen.queryByTestId('app-daemon-banner')).not.toBeInTheDocument()
      })
      // The shown pane attached the same terminal again on the new connection.
      await waitFor(() => {
        expect(fakeBridge.attachCalls().filter((id) => id === claude.id)).toHaveLength(attached + 1)
      })
      expect(screen.getByTestId(`terminal-tab-${claude.id}`)).toBeInTheDocument()
      expect(screen.getByTestId(`terminal-tab-${claude.id}-select`)).toHaveAttribute(
        'aria-selected',
        'true'
      )

      for (const t of [claude, docsShell, homeShell]) {
        expect(screen.queryByTestId(`terminal-tab-${t.id}-exited`)).not.toBeInTheDocument()
      }

      expect((await window.que.term.list()).map((t) => [t.id, t.alive])).toEqual([
        [claude.id, true],
        [docsShell.id, true],
        [homeShell.id, true]
      ])
    })
  })

  describe('errors', () => {
    it('falls back to the restart when the update in place fails, naming the reason and what it ends', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.setDaemon(STALE)
      fakeBridge.refuseUpgrade('the new daemon exited (code 3)')
      render(<App />)

      await user.click(await screen.findByRole('button', { name: 'Update' }))

      expect(await screen.findByRole('button', { name: 'Restart' })).toBeEnabled()
      expect(screen.getByTestId('app-daemon-banner')).toHaveTextContent(
        'The service could not be updated in place: the new daemon exited (code 3). Restart it instead. This ends 3 terminals (1 working).'
      )
      expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument()
      // Nothing restarts on its own.
      expect(fakeBridge.restartCalls()).toBe(0)
    })

    it('restarts the daemon on the fallback click, then goes away with the stale build', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.setDaemon(STALE)
      fakeBridge.refuseUpgrade('the running service is too old to update in place')
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'Update' }))

      await user.click(await screen.findByRole('button', { name: 'Restart' }))

      await waitFor(() => {
        expect(screen.queryByTestId('app-daemon-banner')).not.toBeInTheDocument()
      })
      expect(fakeBridge.upgradeCalls()).toBe(1)
      expect(fakeBridge.restartCalls()).toBe(1)
    })
  })

  describe('empty state', () => {
    it('shows nothing, and never updates or restarts, while the daemon runs this build', async () => {
      seed()
      render(<App />)

      await screen.findAllByRole('tab')
      await waitFor(() => {
        expect(fakeBridge.daemonStateCalls()).toBeGreaterThan(0)
      })
      expect(screen.queryByTestId('app-daemon-banner')).not.toBeInTheDocument()
      expect(fakeBridge.upgradeCalls()).toBe(0)
      expect(fakeBridge.restartCalls()).toBe(0)
    })
  })
})
