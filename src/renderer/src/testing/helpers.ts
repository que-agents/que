// Interaction helpers shared by renderer component tests.
import { screen, waitFor } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'
import { expect } from 'vitest'

/** Opens the workspace from the sidebar and waits for its first terminal; returns that terminal's id. */
export async function openWorkspace(
  user: ReturnType<typeof userEvent.setup>,
  wsId: string
): Promise<string> {
  await user.click(await screen.findByTestId(`sidebar-workspace-${wsId}-open`))
  const pane = await screen.findByTestId('pane-0')
  await waitFor(() => {
    expect(pane.dataset.activeTerm).not.toBe('')
  })

  return pane.dataset.activeTerm as string
}

/** The ISO time `minutes` before `now`: a fixture's `finishedAt`, `seenAt` or `at`. */
export function minutesAgo(now: number, minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString()
}
