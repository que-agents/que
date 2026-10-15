import { useState } from 'react'
import type { Ticket } from '../../../preload/index.d'
import { formatAge } from '../format'
import { useQue, useStore } from '../store'

/** `synced 14:05` in local time, or `synced never`. */
function syncedAt(iso: string | null): string {
  if (!iso) return 'synced never'
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `synced ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Open tickets first in the given order, done ones after. */
function ordered(tickets: Ticket[]): Ticket[] {
  const open = tickets.filter((t) => t.statusCategory !== 'done')
  return [...open, ...tickets.filter((t) => t.statusCategory === 'done')]
}

/** The tickets assigned to the user, with Start on each. */
export default function TicketsView(): React.JSX.Element {
  const store = useStore()
  const { connected, tickets, ticketsSync, workspaces } = useQue()
  const [syncing, setSyncing] = useState(false)

  const sync = async (): Promise<void> => {
    setSyncing(true)
    try {
      await store.syncTickets()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="report tickets" data-testid="tickets-view" aria-labelledby="tickets-title">
      <header className="topbar">
        <h1 className="title" id="tickets-title">
          Tickets
        </h1>
        <span className="cwd muted" data-testid="tickets-synced">
          {syncedAt(ticketsSync.lastSyncAt)}
        </span>
        <div className="actions">
          <button
            type="button"
            data-testid="tickets-sync"
            disabled={!connected || syncing}
            onClick={() => void sync()}
          >
            Sync
          </button>
        </div>
      </header>
      <div className="report-body">
        {ticketsSync.error && (
          <p className="form-error" role="alert" data-testid="tickets-error">
            {ticketsSync.error}
          </p>
        )}
        {tickets.length === 0 && !ticketsSync.error && (
          <p className="empty-note" data-testid="tickets-empty">
            No tickets assigned to you.
          </p>
        )}
        <ul>
          {ordered(tickets).map((t) => {
            const ws = t.workspaceId ? workspaces[t.workspaceId] : undefined
            return (
              <li
                key={t.key}
                className={
                  t.statusCategory === 'done' ? 'report-row ticket done' : 'report-row ticket'
                }
                data-testid={`ticket-${t.key}`}
              >
                <a
                  className="key"
                  href={t.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Open ticket"
                  data-testid={`ticket-${t.key}-open`}
                >
                  {t.key}
                </a>
                <span className="name summary">{t.summary}</span>
                <span className="muted">{t.status}</span>
                <span className="muted">{t.priority ?? ''}</span>
                <span className="muted">{formatAge(t.updatedAt, store.now())}</span>
                {ws ? (
                  <button
                    type="button"
                    data-testid={`ticket-${t.key}-workspace`}
                    onClick={() => store.showTerminals(ws.id)}
                  >
                    {ws.name}
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid={`ticket-${t.key}-start`}
                    disabled={!connected}
                    onClick={() => void store.beginTicket(t.key)}
                  >
                    Start
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
