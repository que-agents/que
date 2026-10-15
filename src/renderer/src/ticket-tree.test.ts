import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../preload/index.d'
import { makeTicket } from './testing/fixtures'
import { buildTicketTree, countOpenTickets } from './ticket-tree'

const epic = (key: string, extra: Partial<Ticket> = {}): Ticket =>
  makeTicket({ key, level: 'epic', ...extra })
const child = (key: string, parentKey: string | null, extra: Partial<Ticket> = {}): Ticket =>
  makeTicket({ key, parentKey, ...extra })

describe('buildTicketTree', () => {
  it('groups children under epics, nests subtasks, and leaves the rest loose', () => {
    const tree = buildTicketTree([
      epic('E-1'),
      child('A-1', 'E-1'),
      child('A-2', 'E-1'),
      child('A-3', 'A-2', { level: 'subtask' }),
      epic('E-2'),
      child('B-1', 'E-2'),
      child('L-1', null),
      child('O-1', 'GONE-9')
    ])

    expect(tree.groups.map((g) => g.epic.key)).toEqual(['E-1', 'E-2'])
    expect(tree.groups[0].children.map((n) => n.ticket.key)).toEqual(['A-1', 'A-2'])
    expect(tree.groups[0].children[1].subtasks.map((s) => s.key)).toEqual(['A-3'])
    expect(tree.groups[1].children.map((n) => n.ticket.key)).toEqual(['B-1'])
    expect(tree.loose.map((n) => n.ticket.key)).toEqual(['L-1', 'O-1'])
  })

  it('keeps an epic with no children as a group', () => {
    const tree = buildTicketTree([epic('E-1')])
    expect(tree.groups.map((g) => [g.epic.key, g.children])).toEqual([['E-1', []]])
    expect(tree.loose).toEqual([])
  })

  it('nests a subtask under a loose parent', () => {
    const tree = buildTicketTree([child('L-1', null), child('L-2', 'L-1', { level: 'subtask' })])
    expect(tree.loose).toHaveLength(1)
    expect(tree.loose[0].subtasks.map((s) => s.key)).toEqual(['L-2'])
  })
})

describe('countOpenTickets', () => {
  it('ignores epics, unassigned parents and done tickets', () => {
    expect(
      countOpenTickets([
        epic('E-1'),
        child('A-1', 'E-1'),
        child('A-2', 'E-1', { statusCategory: 'done' }),
        child('A-3', null, { assigned: false }),
        child('A-4', null, { statusCategory: 'new' })
      ])
    ).toBe(2)
  })
})
