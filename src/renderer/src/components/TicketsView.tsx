import { Fragment, useState } from 'react'
import type { Ticket } from '../../../preload/index.d'
import { formatAge, hhmm } from '../../../shared/format'
import { matches } from '../sidebar-order'
import { useQue, useStore } from '../store'
import { buildTicketTree, type TicketNode } from '../ticket-tree'
import { useNow } from '../useNow'

/** `synced 14:05` in local time, or `synced never`. */
function syncedAt(iso: string | null): string {
  return iso ? `synced ${hhmm(Date.parse(iso))}` : 'synced never'
}

/** Open items first in the given order, done ones after. */
function ordered<T>(items: T[], done: (item: T) => boolean): T[] {
  return [...items.filter((i) => !done(i)), ...items.filter(done)]
}

const hit = (filter: string, t: Ticket): boolean => matches(filter, t.key, t.summary)
const nodeDone = (n: TicketNode): boolean => n.ticket.statusCategory === 'done'
const ticketDone = (t: Ticket): boolean => t.statusCategory === 'done'

/** Keep the nodes that match, or whose subtasks do; a matching node keeps all its subtasks. */
function filterNodes(filter: string, nodes: TicketNode[]): TicketNode[] {
  const kept: TicketNode[] = []

  for (const n of nodes) {
    if (hit(filter, n.ticket)) kept.push(n)
    else {
      const subtasks = n.subtasks.filter((s) => hit(filter, s))

      if (subtasks.length > 0) kept.push({ ticket: n.ticket, subtasks })
    }
  }

  return kept
}

function statusTone(t: Ticket): string {
  if (t.statusCategory === 'done') return 'good'

  return t.statusCategory === 'indeterminate' ? 'busy' : 'neutral'
}

/** The tickets assigned to the user under their epics, with Start on each. */
export default function TicketsView(): React.JSX.Element {
  const store = useStore()
  const { connected, tickets, ticketsSync, filter } = useQue()
  // The rows' "updated … ago" ages move on their own; the rows re-render with this view.
  useNow()
  const tree = buildTicketTree(tickets)

  const groups = tree.groups
    .map((g) => ({
      epic: g.epic,
      children: hit(filter, g.epic) ? g.children : filterNodes(filter, g.children)
    }))
    .filter((g) => g.children.length > 0 || hit(filter, g.epic))

  const loose = filterNodes(filter, tree.loose)
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
        {tickets.length > 0 && groups.length + loose.length === 0 && (
          <p className="empty-note" data-testid="tickets-nomatch">
            Nothing matches
          </p>
        )}
        <ul>
          {groups.map((g) => (
            <Fragment key={g.epic.key}>
              <EpicRow t={g.epic} />
              {ordered(g.children, nodeDone).map((n) => (
                <NodeRows key={n.ticket.key} node={n} parent={g.epic.key} depth={1} />
              ))}
            </Fragment>
          ))}
          {groups.length > 0 && loose.length > 0 && (
            <li className="loose-label" data-testid="tickets-loose">
              no epic
            </li>
          )}
          {ordered(loose, nodeDone).map((n) => (
            <NodeRows key={n.ticket.key} node={n} parent={null} depth={0} />
          ))}
        </ul>
      </div>
    </section>
  )
}

function TicketLink({ t }: { t: Ticket }): React.JSX.Element {
  if (!t.url) return <span className="key">{t.key}</span>

  return (
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
  )
}

/** An epic: an overview header, with no Start. */
function EpicRow({ t }: { t: Ticket }): React.JSX.Element {
  return (
    <li
      className={ticketDone(t) ? 'report-row ticket epic done' : 'report-row ticket epic'}
      data-testid={`ticket-${t.key}`}
      data-level="epic"
    >
      <TicketLink t={t} />
      <span className="name summary">{t.summary}</span>
      {!t.assigned && (
        <span className="muted unassigned" data-testid={`ticket-${t.key}-unassigned`}>
          not yours
        </span>
      )}
      <span className={`status tone-${statusTone(t)}`}>{t.status}</span>
    </li>
  )
}

/** A ticket you can start, with its subtasks one level deeper. */
function NodeRows({
  node,
  parent,
  depth
}: {
  node: TicketNode
  parent: string | null
  depth: number
}): React.JSX.Element {
  return (
    <>
      <TicketRow t={node.ticket} parent={parent} depth={depth} />
      {ordered(node.subtasks, ticketDone).map((s) => (
        <TicketRow key={s.key} t={s} parent={node.ticket.key} depth={depth + 1} />
      ))}
    </>
  )
}

function TicketRow({
  t,
  parent,
  depth
}: {
  t: Ticket
  parent: string | null
  depth: number
}): React.JSX.Element {
  const store = useStore()
  const { connected, workspaces } = useQue()
  const ws = t.workspaceId ? workspaces[t.workspaceId] : undefined

  return (
    <li
      className={ticketDone(t) ? 'report-row ticket done' : 'report-row ticket'}
      data-testid={`ticket-${t.key}`}
      data-level={t.level === 'subtask' ? 'subtask' : 'standard'}
      data-parent={parent ?? undefined}
      style={{ '--depth': depth } as React.CSSProperties}
    >
      <TicketLink t={t} />
      <span className="name summary">{t.summary}</span>
      <span className="muted">{t.status}</span>
      <span className="muted">{t.priority ?? ''}</span>
      <span className="muted">{formatAge(t.updatedAt, store.now(), ' ago')}</span>
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
}
