// The quiet board's words: the count line and the line an empty board shows.
// The board answers one question, "running and not stuck?", from across the
// room without pulling anyone in, so nothing here reads as a message: counts
// only when non-zero, and needs input counts as plain `waiting` (it is not a
// night state). Pure; the renderer turns the items into spans.
import { type CountItem } from './count-line'
import { hhmm } from './format'
import { type WorkspaceStatus } from './types'

/** What an empty board and an all-zero count line say. */
export const NOTHING_RUNNING = 'nothing running'

export interface BoardTallyInput {
  /** Every workspace, and whether it has a live terminal (which puts it on the board). */
  workspaces: ReadonlyArray<{ id: string; status: WorkspaceStatus; hasTerminal: boolean }>
}

/** The board's counts. */
export interface BoardTally {
  stuck: number
  running: number
  waiting: number
  /** Idle workspaces that are on the board (they have a live terminal). */
  idle: number
}

/** The workspaces' counts: stuck, working (running), needs input (waiting), and idle on the board. */
export function boardTally({ workspaces }: BoardTallyInput): BoardTally {
  const count = (status: WorkspaceStatus): number =>
    workspaces.filter((w) => w.status === status).length

  return {
    stuck: count('stuck'),
    running: count('working'),
    waiting: count('needs_input'),
    idle: workspaces.filter((w) => w.status === 'idle' && w.hasTerminal).length
  }
}

/**
 * The count line, in reading order and only the non-zero counts: stuck (the
 * one word with a tone), running (muted), waiting, idle. Empty when everything is zero.
 */
export function boardCountItems(t: BoardTally): CountItem[] {
  const items: CountItem[] = [
    { count: t.stuck, label: 'stuck', tone: 'bad' },
    { count: t.running, label: 'running', tone: 'muted' },
    { count: t.waiting, label: 'waiting' },
    { count: t.idle, label: 'idle' }
  ]

  return items.filter((i) => i.count > 0)
}

/**
 * The one line an empty board shows: `nothing running`, then when the morning
 * summary arrives (only when it is on).
 */
export function boardEmptyLine(input: { summaryAt: number | null }): string {
  const parts = [NOTHING_RUNNING]

  if (input.summaryAt !== null) parts.push(`summary at ${hhmm(input.summaryAt)}`)

  return parts.join(' · ')
}
