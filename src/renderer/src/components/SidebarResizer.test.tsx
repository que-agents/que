import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject } from '@renderer/testing/fixtures'
import App from '../App'

const separator = (): HTMLElement => screen.getByRole('separator', { name: 'Resize sidebar' })
const appWidth = (): string =>
  screen.getByTestId('app-shell').style.getPropertyValue('--sidebar-width')

async function openApp(): Promise<void> {
  fakeBridge.seedProject(makeProject())
  render(<App />)
  await screen.findByTestId('sidebar-sessions-add')
}

describe('SidebarResizer', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('rendering', () => {
    it('starts at the default width, and at the remembered one on the next launch', async () => {
      await openApp()
      expect(separator()).toHaveAttribute('aria-valuenow', '256')
      expect(appWidth()).toBe('256px')
    })

    it('uses the remembered width, clamped, and ignores a garbage value', async () => {
      localStorage.setItem('que.sidebarWidth', '900')
      await openApp()
      expect(separator()).toHaveAttribute('aria-valuenow', '520')
    })

    it('falls back to the default for a garbage value', async () => {
      localStorage.setItem('que.sidebarWidth', 'wide')
      await openApp()
      expect(separator()).toHaveAttribute('aria-valuenow', '256')
    })
  })

  describe('user interactions', () => {
    it('drags the divider with the pointer, within the limits', async () => {
      const user = userEvent.setup()
      await openApp()
      const sep = separator()

      await user.pointer([
        { keys: '[MouseLeft>]', target: sep, coords: { x: 256, clientX: 256 } },
        { target: sep, coords: { x: 356, clientX: 356 } },
        { keys: '[/MouseLeft]', target: sep, coords: { x: 356, clientX: 356 } }
      ])

      expect(sep).toHaveAttribute('aria-valuenow', '356')
      expect(appWidth()).toBe('356px')
      expect(localStorage.getItem('que.sidebarWidth')).toBe('356')

      await user.pointer([
        { keys: '[MouseLeft>]', target: sep, coords: { x: 356, clientX: 356 } },
        { target: sep, coords: { x: 0, clientX: 0 } },
        { keys: '[/MouseLeft]', target: sep, coords: { x: 0, clientX: 0 } }
      ])

      expect(sep).toHaveAttribute('aria-valuenow', '180')
    })

    it('goes back to the default on double-click', async () => {
      const user = userEvent.setup()
      localStorage.setItem('que.sidebarWidth', '400')
      await openApp()

      await user.dblClick(separator())

      expect(separator()).toHaveAttribute('aria-valuenow', '256')
      expect(localStorage.getItem('que.sidebarWidth')).toBe('256')
    })
  })

  describe('keyboard', () => {
    it('moves by 16px with the arrow keys and jumps to the limits with Home and End', async () => {
      const user = userEvent.setup()
      await openApp()
      separator().focus()

      await user.keyboard('{ArrowRight}{ArrowRight}')
      expect(separator()).toHaveAttribute('aria-valuenow', '288')

      await user.keyboard('{ArrowLeft}')
      expect(separator()).toHaveAttribute('aria-valuenow', '272')

      await user.keyboard('{End}')
      expect(separator()).toHaveAttribute('aria-valuenow', '520')

      await user.keyboard('{Home}')
      expect(separator()).toHaveAttribute('aria-valuenow', '180')
      expect(appWidth()).toBe('180px')
    })
  })
})
