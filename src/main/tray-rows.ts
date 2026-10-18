// The rows the menu-bar title is counted from. The tray lists workspaces and
// tasks once, then patches them from the daemon's created, updated, and removed
// events, so a status change costs no round trip.
import type { Events } from '../shared/protocol'
import type { Task, Workspace } from '../shared/types'

export interface TrayRows {
  workspaces: ReadonlyMap<string, Workspace>
  tasks: ReadonlyMap<string, Task>
}

/** The events that change which rows exist or what state they are in. */
export type TrayEventName =
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.removed'
  | 'task.created'
  | 'task.updated'
  | 'task.removed'

export const TRAY_EVENTS: TrayEventName[] = [
  'workspace.created',
  'workspace.updated',
  'workspace.removed',
  'task.created',
  'task.updated',
  'task.removed'
]

export function rowsFromLists(workspaces: Workspace[], tasks: Task[]): TrayRows {
  return {
    workspaces: new Map(workspaces.map((w) => [w.id, w])),
    tasks: new Map(tasks.map((t) => [t.id, t]))
  }
}

function put<T extends { id: string }>(map: ReadonlyMap<string, T>, row: T): Map<string, T> {
  return new Map(map).set(row.id, row)
}

function drop<T>(map: ReadonlyMap<string, T>, id: string): Map<string, T> {
  const next = new Map(map)
  next.delete(id)

  return next
}

/** Returns the rows after one daemon event; the input is left as it was. */
export function applyTrayEvent<E extends TrayEventName>(
  rows: TrayRows,
  event: E,
  data: Events[E]
): TrayRows {
  switch (event) {
    case 'workspace.created':
    case 'workspace.updated':
      return { ...rows, workspaces: put(rows.workspaces, data as Workspace) }
    case 'workspace.removed':
      return { ...rows, workspaces: drop(rows.workspaces, (data as { id: string }).id) }
    case 'task.created':
    case 'task.updated':
      return { ...rows, tasks: put(rows.tasks, data as Task) }
    case 'task.removed':
      return { ...rows, tasks: drop(rows.tasks, (data as { id: string }).id) }
    default:
      return rows
  }
}
