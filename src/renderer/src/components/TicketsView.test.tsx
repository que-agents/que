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

  describe('hierarchy', () => {
    const epicA = makeTicket({
      key: 'EP-1',
      summary: 'Faster uploads',
      level: 'epic',
      assigned: false,
      url: ''
    })
    const epicB = makeTicket({ key: 'EP-2', summary: 'Quiet auth', level: 'epic' })
    const childA = makeTicket({ key: 'APP-10', summary: 'Chunk the body', parentKey: 'EP-1' })
    const subtask = makeTicket({
      key: 'APP-11',
      summary: 'Pick a chunk size',
      level: 'subtask',
      parentKey: 'APP-10'
    })
    const childB = makeTicket({ key: 'APP-20', summary: 'Rotate tokens', parentKey: 'EP-2' })
    const childC = makeTicket({ key: 'APP-21', summary: 'Other work', parentKey: 'EP-2' })
    const loose = makeTicket({ key: 'WEB-1', summary: 'Fix the footer' })

    function seed(...tickets: ReturnType<typeof makeTicket>[]): void {
      for (const t of tickets) fakeBridge.seedTicket(t)
    }

    it('shows epic headers without Start, children with Start, and the not-yours mark', async () => {
      const user = userEvent.setup()
      seed(epicA, childA, subtask, epicB, childB, loose)
      const view = await openTickets(user)

      const header = within(view).getByTestId('ticket-EP-1')
      expect(header).toHaveAttribute('data-level', 'epic')
      expect(header).toHaveClass('epic')
      expect(header).toHaveTextContent('Faster uploads')
      expect(within(header).queryByRole('button')).not.toBeInTheDocument()
      expect(within(view).getByTestId('ticket-EP-1-unassigned')).toHaveTextContent('not yours')
      expect(within(view).queryByTestId('ticket-EP-2-unassigned')).not.toBeInTheDocument()

      const child = within(view).getByTestId('ticket-APP-10')
      expect(child).toHaveAttribute('data-parent', 'EP-1')
      expect(within(child).getByRole('button', { name: 'Start' })).toBeEnabled()
      const sub = within(view).getByTestId('ticket-APP-11')
      expect(sub).toHaveAttribute('data-parent', 'APP-10')
      expect(sub).toHaveAttribute('data-level', 'subtask')
      expect(within(view).getByTestId('ticket-WEB-1')).not.toHaveAttribute('data-parent')

      const order = within(view)
        .getAllByTestId(/^ticket-[A-Z]+-\d+$/)
        .map((r) => r.dataset.testid)
      expect(order).toEqual([
        'ticket-EP-1',
        'ticket-APP-10',
        'ticket-APP-11',
        'ticket-EP-2',
        'ticket-APP-20',
        'ticket-WEB-1'
      ])
    })

    it('puts a no-epic separator before loose tickets only when there are groups', async () => {
      const user = userEvent.setup()
      seed(epicB, childB, loose)
      const view = await openTickets(user)
      expect(within(view).getByTestId('tickets-loose')).toHaveTextContent('no epic')
    })

    it('has no separator when every ticket is loose', async () => {
      const user = userEvent.setup()
      seed(loose)
      const view = await openTickets(user)
      expect(within(view).getByTestId('ticket-WEB-1')).toBeInTheDocument()
      expect(within(view).queryByTestId('tickets-loose')).not.toBeInTheDocument()
    })

    it('links an epic to its url, and omits the link when it has none', async () => {
      const user = userEvent.setup()
      seed(epicA, epicB)
      const view = await openTickets(user)
      expect(within(view).getByTestId('ticket-EP-2-open')).toHaveAttribute('href', epicB.url)
      expect(within(view).queryByTestId('ticket-EP-1-open')).not.toBeInTheDocument()
    })

    it('keeps the epic for a matching child, and shows all children for a matching epic', async () => {
      const user = userEvent.setup()
      seed(epicA, childA, epicB, childB, childC)
      const view = await openTickets(user)

      await user.type(screen.getByTestId('sidebar-filter'), 'rotate')
      expect(within(view).getByTestId('ticket-EP-2')).toBeInTheDocument()
      expect(within(view).getByTestId('ticket-APP-20')).toBeInTheDocument()
      expect(within(view).queryByTestId('ticket-APP-21')).not.toBeInTheDocument()
      expect(within(view).queryByTestId('ticket-EP-1')).not.toBeInTheDocument()

      await user.clear(screen.getByTestId('sidebar-filter'))
      await user.type(screen.getByTestId('sidebar-filter'), 'quiet auth')
      expect(within(view).getByTestId('ticket-APP-20')).toBeInTheDocument()
      expect(within(view).getByTestId('ticket-APP-21')).toBeInTheDocument()
      expect(within(view).queryByTestId('ticket-APP-10')).not.toBeInTheDocument()

      await user.type(screen.getByTestId('sidebar-filter'), 'zzz')
      expect(within(view).getByTestId('tickets-nomatch')).toBeInTheDocument()
    })
  })
})
