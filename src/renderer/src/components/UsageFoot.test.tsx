import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeWorkspace } from '@renderer/testing/fixtures'
import type { Usage } from '../../../shared/types'
import App from '../App'

// Local wall-clock times: the reading was taken Tue 27 Oct 2026 at 14:08, and it is 14:10 now.
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime()
const NOW = at(27, 14, 10)
const clock = (): number => NOW

const retry = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })

/** A reading: 42% of the five hours (resetting at 16:20), 18% of the week (Mon 2 Nov 09:00). */
function reading(over: Partial<Usage> = {}): Usage {
  return {
    fiveHour: { pct: 42.4, resetsAt: at(27, 16, 20) },
    sevenDay: { pct: 17.6, resetsAt: new Date(2026, 10, 2, 9, 0).getTime() },
    at: at(27, 14, 8),
    ...over
  }
}

const button = (): HTMLElement => screen.getByTestId('sidebar-usage')
const fiveHour = (): HTMLElement => screen.getByTestId('sidebar-usage-five-hour')
const weekly = (): HTMLElement => screen.getByTestId('sidebar-usage-weekly')
const card = (): HTMLElement => screen.getByTestId('sidebar-usage-card')

async function renderWith(u: Usage | null): Promise<void> {
  fakeBridge.setUsage(u)
  render(<App now={clock} />)
  await screen.findByTestId('sidebar-usage')
  // The first load has brought the reading in (or there is none).
  await waitFor(() => {
    expect(button().classList.contains('no-reading')).toBe(u === null)
  })
}

describe('UsageFoot', () => {
  describe('rendering', () => {
    it('reads both windows at the strip’s right end, named for a screen reader', async () => {
      await renderWith(reading())

      expect(button().parentElement).toBe(screen.getByTestId('sidebar-strip'))
      expect(button()).toHaveAccessibleName('Claude usage: 5-hour 42%, weekly 18%')
      expect(button()).toHaveTextContent(/^5h 42%wk 18%$/)
      expect(fiveHour()).not.toHaveAttribute('data-tone')
      expect(weekly()).not.toHaveAttribute('data-tone')
      expect(button()).toHaveAttribute('aria-expanded', 'false')
    })

    it.each([
      { pct: 79, tone: null, text: /^5h 79%wk 18%$/ },
      { pct: 80, tone: 'attention', text: /^5h 80%wk 18%$/ },
      // Only a full window reads the time until it resets.
      { pct: 100, tone: 'bad', text: /^5h 100% · 38mwk 18%$/ }
    ])('tones a window at $pct%', async ({ pct, tone, text }) => {
      await renderWith(reading({ fiveHour: { pct, resetsAt: at(27, 14, 48) } }))

      expect(button()).toHaveTextContent(text)
      expect(fiveHour().getAttribute('data-tone')).toBe(tone)
    })

    it('tones the weekly window apart from the five-hour one', async () => {
      await renderWith(
        reading({ sevenDay: { pct: 100, resetsAt: new Date(2026, 9, 28, 9, 0).getTime() } })
      )

      expect(fiveHour()).not.toHaveAttribute('data-tone')
      expect(weekly()).toHaveAttribute('data-tone', 'bad')
      expect(screen.getByTestId('sidebar-usage-weekly-until')).toHaveTextContent('· 18h 50m')
    })

    it('reads dashes before any reading, its tooltip saying when one comes, and opens nothing', async () => {
      const user = userEvent.setup()
      await renderWith(null)

      expect(button()).toHaveTextContent(/^5h —wk —$/)
      expect(button()).toHaveClass('no-reading')
      expect(button()).toHaveAccessibleName('Claude usage: no reading yet')
      expect(button()).toHaveAttribute(
        'title',
        "Claude usage fills in after a session's first reply, on plans with usage limits"
      )
      expect(button()).not.toHaveAttribute('aria-expanded')

      await user.click(button())

      expect(screen.queryByTestId('sidebar-usage-card')).not.toBeInTheDocument()
    })

    it('shows a dash for a window the reading does not have', async () => {
      await renderWith({ sevenDay: reading().sevenDay, at: at(27, 14, 8) })

      expect(fiveHour()).toHaveTextContent('—')
      expect(weekly()).toHaveTextContent('18%')
      expect(button()).toHaveAccessibleName('Claude usage: 5-hour no reading, weekly 18%')
    })
  })

  describe('the card', () => {
    it('opens on a click with a line and a meter per window, then when and where it was read', async () => {
      const user = userEvent.setup()
      fakeBridge.seedWorkspace(retry)
      await renderWith(reading({ workspaceId: retry.id }))

      await user.click(button())

      expect(card()).toHaveAccessibleName('Claude usage')
      expect(button()).toHaveAttribute('aria-expanded', 'true')
      expect(within(card()).getByText('Claude usage')).toHaveClass('label')

      const five = screen.getByTestId('sidebar-usage-card-five-hour')
      expect(five).toHaveTextContent(/^5-hour42%resets 16:20 · in 2h 10m$/)
      expect(screen.getByTestId('sidebar-usage-card-five-hour-meter')).toHaveStyle({ width: '42%' })

      const week = screen.getByTestId('sidebar-usage-card-weekly')
      expect(week).toHaveTextContent(/^weekly18%resets Mon 09:00$/)
      expect(screen.getByTestId('sidebar-usage-card-weekly-meter')).toHaveStyle({ width: '18%' })

      expect(screen.getByTestId('sidebar-usage-card-as-of')).toHaveTextContent(
        /^as of 14:08 · app-1432-retry-logic$/
      )
    })

    it('tones a full window’s percent and meter, the meter no wider than the track', async () => {
      const user = userEvent.setup()
      await renderWith(
        reading({
          fiveHour: { pct: 104, resetsAt: at(27, 14, 48) },
          sevenDay: { pct: 85, resetsAt: new Date(2026, 10, 2, 9, 0).getTime() }
        })
      )

      await user.click(button())

      const fivePct = screen.getByTestId('sidebar-usage-card-five-hour-percent')
      expect(fivePct).toHaveTextContent('104%')
      expect(fivePct).toHaveAttribute('data-tone', 'bad')
      const fiveMeter = screen.getByTestId('sidebar-usage-card-five-hour-meter')
      expect(fiveMeter).toHaveAttribute('data-tone', 'bad')
      expect(fiveMeter).toHaveStyle({ width: '100%' })
      expect(screen.getByTestId('sidebar-usage-card-weekly-percent')).toHaveAttribute(
        'data-tone',
        'attention'
      )
      expect(screen.getByTestId('sidebar-usage-card-weekly-meter')).toHaveAttribute(
        'data-tone',
        'attention'
      )
    })

    it('leaves the workspace out of the as-of line when it is not known', async () => {
      const user = userEvent.setup()
      await renderWith(reading({ workspaceId: 'ws_01hzx9gone000' }))

      await user.click(button())

      expect(screen.getByTestId('sidebar-usage-card-as-of')).toHaveTextContent(/^as of 14:08$/)
    })

    it('reads a dash and an empty meter for a window the reading does not have', async () => {
      const user = userEvent.setup()
      await renderWith({ sevenDay: reading().sevenDay, at: at(27, 14, 8) })

      await user.click(button())

      expect(screen.getByTestId('sidebar-usage-card-five-hour-percent')).toHaveTextContent('—')
      expect(screen.getByTestId('sidebar-usage-card-five-hour-resets')).toBeEmptyDOMElement()
      expect(screen.getByTestId('sidebar-usage-card-five-hour-meter')).toHaveStyle({ width: '0%' })
    })

    it('closes on Escape', async () => {
      const user = userEvent.setup()
      await renderWith(reading())
      await user.click(button())
      expect(card()).toBeInTheDocument()

      await user.keyboard('{Escape}')

      expect(screen.queryByTestId('sidebar-usage-card')).not.toBeInTheDocument()
      expect(button()).toHaveAttribute('aria-expanded', 'false')
    })

    it('closes on a press elsewhere, and stays open for a press inside it', async () => {
      const user = userEvent.setup()
      await renderWith(reading())
      await user.click(button())

      await user.click(screen.getByTestId('sidebar-usage-card-weekly'))
      expect(card()).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Report' }))

      expect(screen.queryByTestId('sidebar-usage-card')).not.toBeInTheDocument()
    })

    it('closes on a second click of the button', async () => {
      const user = userEvent.setup()
      await renderWith(reading())

      await user.click(button())
      expect(card()).toBeInTheDocument()
      await user.click(button())

      expect(screen.queryByTestId('sidebar-usage-card')).not.toBeInTheDocument()
    })
  })

  describe('status updates', () => {
    it('follows usage.changed on the button and in the open card', async () => {
      const user = userEvent.setup()
      await renderWith(reading())
      await user.click(button())

      fakeBridge.setUsage(
        reading({
          fiveHour: { pct: 81, resetsAt: at(27, 16, 20) },
          sevenDay: { pct: 19, resetsAt: new Date(2026, 10, 2, 9, 0).getTime() },
          at: at(27, 14, 9)
        })
      )

      await waitFor(() => {
        expect(button()).toHaveAccessibleName('Claude usage: 5-hour 81%, weekly 19%')
      })
      expect(fiveHour()).toHaveAttribute('data-tone', 'attention')
      expect(screen.getByTestId('sidebar-usage-card-five-hour-percent')).toHaveTextContent('81%')
      expect(screen.getByTestId('sidebar-usage-card-five-hour-meter')).toHaveStyle({ width: '81%' })
      expect(screen.getByTestId('sidebar-usage-card-weekly-percent')).toHaveTextContent('19%')
      expect(screen.getByTestId('sidebar-usage-card-as-of')).toHaveTextContent(/^as of 14:09$/)
    })

    it('goes back to dashes, and the card away, when the reading is dropped, and a later one leaves it closed', async () => {
      const user = userEvent.setup()
      await renderWith(reading())
      await user.click(button())

      fakeBridge.setUsage(null)

      await waitFor(() => {
        expect(button()).toHaveTextContent(/^5h —wk —$/)
      })
      expect(screen.queryByTestId('sidebar-usage-card')).not.toBeInTheDocument()

      // The next reading fills the button in but does not open the card again.
      fakeBridge.setUsage(reading({ at: at(27, 14, 9) }))

      await waitFor(() => {
        expect(button()).toHaveAccessibleName('Claude usage: 5-hour 42%, weekly 18%')
      })
      expect(button()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByTestId('sidebar-usage-card')).not.toBeInTheDocument()
    })
  })
})
