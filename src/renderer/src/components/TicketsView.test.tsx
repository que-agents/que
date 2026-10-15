import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeProject, makeTicket } from '@renderer/testing/fixtures'
import App from '../App'

const NOW = Date.parse('2026-10-14T03:12:00.000Z')
const uploader = makeProject()
const retry = makeTicket()
const refresh = makeTicket({
  key: 'APP-1440',
  summary: 'Refresh the auth token',
  status: 'To Do',
  statusCategory: 'new',
  priority: 'High',
  url: 'https://example.atlassian.net/browse/APP-1440'
})
const shipped = makeTicket({
  key: 'APP-1301',
  summary: 'Ship the quiet board',
  status: 'Done',
  statusCategory: 'done',
  priority: null
})
const WS_NAME = 'app-1432-add-retry-logic-to-the-uploader'

async function openTickets(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  render(<App now={() => NOW} />)
  await user.click(await screen.findByRole('button', { name: /^Tickets/ }))
  return screen.findByTestId('tickets-view')
}

describe('TicketsView', () => {
  describe('rendering', () => {
    it('lists the tickets in order with key link, status, priority and age, done ones last', async () => {
      const user = userEvent.setup()
      fakeBridge.seedTicket(shipped)
      fakeBridge.seedTicket(retry)
      fakeBridge.seedTicket(refresh)

      const view = await openTickets(user)

      const rows = within(view).getAllByTestId(/^ticket-APP-\d+$/)
      expect(rows.map((r) => r.dataset.testid)).toEqual([
        'ticket-APP-1432',
        'ticket-APP-1440',
        'ticket-APP-1301'
      ])
      const row = within(view).getByTestId('ticket-APP-1432')
      const link = within(row).getByRole('link', { name: 'APP-1432' })
      expect(link).toHaveAttribute('href', retry.url)
      expect(link).toHaveAttribute('title', 'Open ticket')
      expect(row).toHaveTextContent('Add retry logic to the uploader')
      expect(row).toHaveTextContent('In Progress')
      expect(row).toHaveTextContent('Medium')
      expect(row).toHaveTextContent('2h ago')
      expect(within(row).getByRole('button', { name: 'Start' })).toBeEnabled()
      expect(within(view).getByTestId('ticket-APP-1301')).toHaveClass('done')
      expect(screen.getByTestId('tickets-synced')).toHaveTextContent('synced never')
    })

    it('shows no age for a ticket without an updated time', async () => {
      const user = userEvent.setup()
      fakeBridge.seedTicket(makeTicket({ updatedAt: null }))
      const view = await openTickets(user)
      const row = within(view).getByTestId('ticket-APP-1432')
      expect(row).not.toHaveTextContent('ago')
      expect(row).not.toHaveTextContent('NaN')
    })

    it('says so when nothing is assigned', async () => {
      const user = userEvent.setup()
      await openTickets(user)
      expect(await screen.findByText('No tickets assigned to you.')).toBeInTheDocument()
    })

    it('shows the sync error and marks the sidebar entry', async () => {
      const user = userEvent.setup()
      fakeBridge.seedTicket(retry)
      const view = await openTickets(user)

      fakeBridge.setTicketsError('Not authenticated')

      expect(await within(view).findByRole('alert')).toHaveTextContent('Not authenticated')
      expect(screen.getByTestId('sidebar-tickets-error')).toHaveAttribute(
        'title',
        'Not authenticated'
      )
      expect(screen.queryByTestId('tickets-empty')).not.toBeInTheDocument()
    })
  })

  describe('sync', () => {
    it('asks the daemon to sync and shows when it did', async () => {
      const user = userEvent.setup()
      fakeBridge.seedTicket(retry)
      await openTickets(user)

      await user.click(screen.getByRole('button', { name: 'Sync' }))

      await waitFor(() => expect(fakeBridge.ticketSyncs).toBe(1))
      await waitFor(() =>
        expect(screen.getByTestId('tickets-synced')).toHaveTextContent(/^synced \d\d:\d\d$/)
      )
    })
  })

  describe('start', () => {
    it('asks which project the first time, then opens the workspace it made', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(uploader)
      fakeBridge.seedTicket(retry)
      await openTickets(user)

      await user.click(screen.getByTestId('ticket-APP-1432-start'))

      const dialog = await screen.findByRole('dialog', { name: 'Start APP-1432' })
      const select = within(dialog).getByTestId('dialog-start-ticket-project')
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent)
      ).toEqual(['uploader', 'A session, no project'])
      await user.selectOptions(select, 'uploader')
      await user.click(within(dialog).getByRole('button', { name: 'Start' }))

      expect(await screen.findByTestId('topbar-title')).toHaveTextContent(WS_NAME)
      const sidebar = screen.getByTestId('sidebar')
      expect(within(sidebar).getByText(WS_NAME)).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^Tickets/ }))
      const button = await screen.findByTestId('ticket-APP-1432-workspace')
      expect(button).toHaveTextContent(WS_NAME)
      expect(screen.queryByTestId('ticket-APP-1432-start')).not.toBeInTheDocument()
    })

    it('goes straight to the workspace when the project is already known', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(uploader)
      fakeBridge.seedTicket(retry)
      fakeBridge.mapTicketProject('APP', uploader.id)
      await openTickets(user)

      await user.click(screen.getByTestId('ticket-APP-1432-start'))

      expect(await screen.findByTestId('topbar-title')).toHaveTextContent(WS_NAME)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('opens a loose session when asked for no project', async () => {
      const user = userEvent.setup()
      fakeBridge.seedProject(uploader)
      fakeBridge.seedTicket(retry)
      await openTickets(user)
      const sessions = screen.getByTestId('sidebar-sessions')
      const before = within(sessions).queryAllByTestId(/^sidebar-session-.+-open$/).length

      await user.click(screen.getByTestId('ticket-APP-1432-start'))
      const dialog = await screen.findByRole('dialog', { name: 'Start APP-1432' })
      await user.selectOptions(
        within(dialog).getByTestId('dialog-start-ticket-project'),
        'A session, no project'
      )
      await user.click(within(dialog).getByRole('button', { name: 'Start' }))

      expect(await screen.findByTestId('topbar-title')).toHaveTextContent('Sessions')
      await waitFor(() =>
        expect(within(sessions).getAllByTestId(/^sidebar-session-.+-open$/)).toHaveLength(
          before + 1
        )
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('filter', () => {
    it('narrows the rows by key or summary, and says when nothing matches', async () => {
      const user = userEvent.setup()
      fakeBridge.seedTicket(retry)
      fakeBridge.seedTicket(refresh)
      const view = await openTickets(user)

      await user.type(screen.getByTestId('sidebar-filter'), 'auth')

      expect(within(view).queryByTestId('ticket-APP-1432')).not.toBeInTheDocument()
      expect(within(view).getByTestId('ticket-APP-1440')).toBeInTheDocument()
      expect(within(view).queryByTestId('tickets-nomatch')).not.toBeInTheDocument()

      await user.clear(screen.getByTestId('sidebar-filter'))
      await user.type(screen.getByTestId('sidebar-filter'), 'app-1432')
      expect(within(view).getByTestId('ticket-APP-1432')).toBeInTheDocument()
      expect(within(view).queryByTestId('ticket-APP-1440')).not.toBeInTheDocument()

      await user.type(screen.getByTestId('sidebar-filter'), 'zzz')
      expect(within(view).getByTestId('tickets-nomatch')).toHaveTextContent('Nothing matches')
      expect(within(view).queryByTestId('tickets-empty')).not.toBeInTheDocument()
    })
  })
})
