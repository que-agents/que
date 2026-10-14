import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import App from '../App'

const update = { version: '0.2.0', url: 'https://github.com/rquellh/que/releases/tag/v0.2.0' }

describe('UpdateBanner', () => {
  describe('rendering', () => {
    it('says a newer release is available when the check already found one', async () => {
      fakeBridge.setUpdate(update)

      render(<App />)

      expect(await screen.findByTestId('app-update-banner')).toHaveTextContent(
        'que 0.2.0 is available.'
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('status updates', () => {
    it('appears when the check finishes after the window opened', async () => {
      render(<App />)
      await screen.findByRole('tab')
      expect(screen.queryByTestId('app-update-banner')).not.toBeInTheDocument()

      fakeBridge.setUpdate(update)

      expect(await screen.findByTestId('app-update-banner')).toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('opens the release page with Download, and goes away when dismissed', async () => {
      const user = userEvent.setup()
      fakeBridge.setUpdate(update)
      render(<App />)

      await user.click(await screen.findByRole('button', { name: 'Download' }))
      await waitFor(() => {
        expect(fakeBridge.openUpdateCalls()).toBe(1)
      })

      await user.click(screen.getByRole('button', { name: 'Dismiss update' }))
      expect(screen.queryByTestId('app-update-banner')).not.toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows nothing when there is no newer release', async () => {
      render(<App />)

      await screen.findByRole('tab')
      expect(screen.queryByTestId('app-update-banner')).not.toBeInTheDocument()
    })
  })
})
