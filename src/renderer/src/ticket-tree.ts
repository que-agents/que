import type { Ticket } from '../../preload/index.d'

export type TicketNode = { ticket: Ticket; subtasks: Ticket[] }
export type TicketTree = {
  groups: Array<{ epic: Ticket; children: TicketNode[] }>
  loose: TicketNode[]
}

/**
 * Group tickets under their epics and subtasks under their parents, keeping the given order.
 * A ticket whose parent is not in the list is loose; a subtask nests under its (top-level) parent.
 */
export function buildTicketTree(tickets: Ticket[]): TicketTree {
  const byKey = new Map(tickets.map((t) => [t.key, t]))
  const groups = new Map<string, { epic: Ticket; children: TicketNode[] }>()
  for (const t of tickets) if (t.level === 'epic') groups.set(t.key, { epic: t, children: [] })

  // The top-level non-epic ancestor of a ticket (itself when its parent is an epic or absent).
  const root = (t: Ticket): Ticket => {
    let cur = t
    const seen = new Set([t.key])
    for (;;) {
      const p = cur.parentKey ? byKey.get(cur.parentKey) : undefined
      if (!p || p.level === 'epic' || seen.has(p.key)) return cur
      seen.add(p.key)
      cur = p
    }
  }

  const nodes = new Map<string, TicketNode>()
  const loose: TicketNode[] = []
  for (const t of tickets) {
    if (t.level === 'epic' || root(t).key !== t.key) continue
    const node: TicketNode = { ticket: t, subtasks: [] }
    nodes.set(t.key, node)
    const group = t.parentKey ? groups.get(t.parentKey) : undefined
    if (group) group.children.push(node)
    else loose.push(node)
  }
  for (const t of tickets) {
    if (t.level === 'epic') continue
    const top = root(t)
    if (top.key !== t.key) nodes.get(top.key)?.subtasks.push(t)
  }
  return { groups: [...groups.values()], loose }
}

/** Tickets the user can work on: assigned, not an epic, not done. */
export function countOpenTickets(tickets: Ticket[]): number {
  return tickets.filter((t) => t.assigned && t.level !== 'epic' && t.statusCategory !== 'done')
    .length
}
