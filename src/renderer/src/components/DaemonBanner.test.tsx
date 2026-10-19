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

/** A daemon still running the build before this app's. */
const STALE = { buildId: '8c41e07d92aa', expectedBuildId: '3f9a2c71b0de', stale: true }

function seed(): void {
  fakeBridge.seedProject(project)
  fakeBridge.seedWorkspace(retry)
  fakeBridge.seedWorkspace(docs)
  fakeBridge.seedTerminal(makeTermInfo({ name: 'claude', workspaceId: retry.id }))
  fakeBridge.seedTerminal(makeTermInfo({ name: 'zsh', workspaceId: docs.id }))
  fakeBridge.seedTerminal(makeTermInfo({ name: 'zsh', cwd: '/Users/dev' }))
}

describe('DaemonBanner', () => {
  describe('rendering', () => {
    it('says the background service runs the previous build and what a restart ends', async () => {
      seed()
      fakeBridge.setDaemon(STALE)

      render(<App />)

      expect(await screen.findByTestId('app-daemon-banner')).toHaveTextContent(
        'que was updated. The background service is still running the previous build. Restart it to pick up the changes. This ends 3 terminals (1 working).'
      )
      expect(screen.getByRole('button', { name: 'Restart' })).toBeEnabled()
    })
  })

  describe('user interactions', () => {
    it('restarts the daemon on the click, then goes away with the stale build', async () => {
      const user = userEvent.setup()
      seed()
      fakeBridge.setDaemon(STALE)
      render(<App />)

      await user.click(await screen.findByRole('button', { name: 'Restart' }))

      await waitFor(() => {
        expect(screen.queryByTestId('app-daemon-banner')).not.toBeInTheDocument()
      })
      expect(fakeBridge.restartCalls()).toBe(1)
    })
  })

  describe('empty state', () => {
    it('shows nothing, and never restarts, while the daemon runs this build', async () => {
      seed()
      render(<App />)

      await screen.findAllByRole('tab')
      await waitFor(() => {
        expect(fakeBridge.daemonStateCalls()).toBeGreaterThan(0)
      })
      expect(screen.queryByTestId('app-daemon-banner')).not.toBeInTheDocument()
      expect(fakeBridge.restartCalls()).toBe(0)
    })
  })
})
