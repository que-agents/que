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

const TITLE =
  'que was updated. The background service still runs the previous build. Update it in place; every terminal keeps running.'

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

/** Every terminal the fake daemon has, alive or not, in its order. */
async function aliveFlags(): Promise<boolean[]> {
  return (await window.que.term.list()).map((t) => t.alive)
}

describe('DaemonUpdate', () => {
  describe('rendering', () => {
    it('sits at the right end of the Settings row while the service runs the previous build, and says why', async () => {
      seed()
      fakeBridge.setDaemon(STALE)

      render(<App />)

      const update = await screen.findByRole('button', { name: 'Update' })
      expect(update).toBeEnabled()
      expect(update).toHaveAttribute('title', TITLE)
      const settings = screen.getByTestId('sidebar-settings')
      expect(update.parentElement).toBe(settings.parentElement)
      expect(
        settings.compareDocumentPosition(update) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('updates the service in place on the click, then goes away with the stale build', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.setDaemon(STALE)
      render(<App />)

      await user.click(await screen.findByRole('button', { name: 'Update' }))

      await waitFor(() => {
        expect(screen.queryByTestId('sidebar-daemon-update')).not.toBeInTheDocument()
      })
      expect(fakeBridge.upgradeCalls()).toBe(1)
      expect(screen.getByTestId('sidebar-settings')).toBeInTheDocument()
    })

    it('reads Updating… and takes no second click until the service answers', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.setDaemon(STALE)
      fakeBridge.holdUpgrade()
      render(<App />)

      await user.click(await screen.findByRole('button', { name: 'Update' }))

      expect(await screen.findByRole('button', { name: 'Updating…' })).toBeDisabled()
      fakeBridge.releaseUpgrade()
      await waitFor(() => {
        expect(screen.queryByTestId('sidebar-daemon-update')).not.toBeInTheDocument()
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
        expect(screen.queryByTestId('sidebar-daemon-update')).not.toBeInTheDocument()
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

      expect(await aliveFlags()).toEqual([true, true, true])
    })
  })

  describe('errors', () => {
    it('puts a refusal on the error line, ends no terminal, and stays for another try', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.setDaemon(STALE)
      fakeBridge.refuseUpgrade('the new daemon exited (code 3)')
      render(<App />)

      await user.click(await screen.findByRole('button', { name: 'Update' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not update the background service in place: the new daemon exited (code 3). It keeps running the previous build with every terminal; to end them and start this build, run que daemon restart.'
      )
      // Back to Update once the refusal is in, and nothing else is on offer.
      expect(await screen.findByRole('button', { name: 'Update' })).toBeEnabled()
      expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument()
      expect(await aliveFlags()).toEqual([true, true, true])
      expect(fakeBridge.upgradeCalls()).toBe(1)
    })

    it('tries again on the next click, and the error line clears when the service takes the update', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.setDaemon(STALE)
      fakeBridge.refuseUpgrade('the running service is too old to update in place')
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'Update' }))
      await screen.findByRole('alert')

      await user.click(await screen.findByRole('button', { name: 'Update' }))

      await waitFor(() => {
        expect(screen.queryByTestId('sidebar-daemon-update')).not.toBeInTheDocument()
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(fakeBridge.upgradeCalls()).toBe(2)
    })
  })

  describe('empty state', () => {
    it('shows nothing, and never asks for an update, while the service runs this build', async () => {
      seed()
      render(<App />)

      await screen.findByTestId('sidebar-settings')
      await waitFor(() => {
        expect(fakeBridge.daemonStateCalls()).toBeGreaterThan(0)
      })
      expect(screen.queryByTestId('sidebar-daemon-update')).not.toBeInTheDocument()
      expect(fakeBridge.upgradeCalls()).toBe(0)
    })
  })
})
