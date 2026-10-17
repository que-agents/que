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
