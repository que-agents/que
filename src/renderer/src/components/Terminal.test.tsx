import { describe, expect, it } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeTermInfo } from '@renderer/testing/fixtures'
import Terminal from './Terminal'

const session = makeTermInfo({
  name: 'claude',
  cwd: '/Users/dev/.que/worktrees/que/app-1432-retry-logic'
})

/** Mounts the terminal, focused, and waits for it to attach. */
async function mount(): Promise<void> {
  fakeBridge.seedTerminal(session)
  render(<Terminal id={session.id} />)
  await waitFor(() => expect(fakeBridge.attachCalls()).toContain(session.id))
}

describe('Terminal', () => {
  describe('keys', () => {
    it('sends a line feed for Shift+Enter, so a program can tell it from Enter', async () => {
      const user = userEvent.setup()
      await mount()

      await user.keyboard('{Shift>}{Enter}{/Shift}')

      await waitFor(() => expect(fakeBridge.getTerminal(session.id)?.input).toBe('\n'))
    })

    it('sends a carriage return for Enter', async () => {
      const user = userEvent.setup()
      await mount()

      await user.keyboard('{Enter}')

      await waitFor(() => expect(fakeBridge.getTerminal(session.id)?.input).toBe('\r'))
    })
  })
})
