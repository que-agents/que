// The quiet board's words: the count line and the line an empty board shows.
// The board answers one question, "running and not stuck?", from across the
// room without pulling anyone in, so nothing here reads as a message: counts
// only when non-zero, and needs input counts as plain `waiting` (it is not a
// night state). Pure; the renderer turns the items into spans.
import { type CountItem } from './count-line'
import { hhmm } from './format'
import { ACTIVE_STATES, LIVE_STATES, type TaskState, type WorkspaceStatus } from './types'

/** What an empty board and an all-zero count line say. */
export const NOTHING_RUNNING = 'nothing running'

export interface BoardTallyInput {
  tasks: ReadonlyArray<{
    workspaceId: string | null
    state: TaskState
    pausedUntil: string | null
    updatedAt: string
  }>
  /** Every workspace, and whether it has a live terminal (which puts it on the board). */
  workspaces: ReadonlyArray<{ id: string; status: WorkspaceStatus; hasTerminal: boolean }>
  /** Tonight began here (the quiet window's start): finished tasks count from then. */
  sinceMs: number
}

/** The board's counts. A workspace and the task running in it count once. */
export interface BoardTally {
  stuck: number
  running: number
  waiting: number
  paused: number
  /** The earliest rate-limit reset among the paused tasks, in ms; null without one. */
  pausedResetsAt: number | null
  done: number
  /** Idle workspaces that are on the board (they have a live terminal). */
  idle: number
  queued: number
}

/**
 * Tonight's counts: live tasks and those that finished since the window
 * started, plus the workspaces. A working (or stuck) workspace whose own task
 * is already counted as running (or stuck) is not counted again.
 */
export function boardTally({ tasks, workspaces, sinceMs }: BoardTallyInput): BoardTally {
  const tonight = tasks.filter(
    (t) => LIVE_STATES.has(t.state) || Date.parse(t.updatedAt) >= sinceMs
  )

  const active = tonight.filter((t) => ACTIVE_STATES.has(t.state))
  const stuckTasks = tonight.filter((t) => t.state === 'stuck')
  const paused = tonight.filter((t) => t.state === 'paused')
  const hosts = (ts: typeof tonight): Set<string | null> => new Set(ts.map((t) => t.workspaceId))
  const activeHosts = hosts(active)
  const stuckHosts = hosts(stuckTasks)

  const ws = (status: WorkspaceStatus, skip?: Set<string | null>) =>
    workspaces.filter((w) => w.status === status && !skip?.has(w.id))

  const resets = paused
    .map((t) => (t.pausedUntil ? Date.parse(t.pausedUntil) : Number.NaN))
    .filter(Number.isFinite)

  return {
    stuck: stuckTasks.length + ws('stuck', stuckHosts).length,
    running: active.length + ws('working', activeHosts).length,
    waiting: ws('needs_input').length,
    paused: paused.length,
    pausedResetsAt: resets.length > 0 ? Math.min(...resets) : null,
    done: tonight.filter((t) => t.state === 'done').length,
    idle: ws('idle').filter((w) => w.hasTerminal).length,
    queued: tonight.filter((t) => t.state === 'queued').length
  }
}

/**
 * The count line, in reading order and only the non-zero counts: stuck (the
 * one word with a tone), running (muted), waiting, paused with the limit's
 * reset time, done, idle. Empty when everything is zero.
 */
export function boardCountItems(t: BoardTally): CountItem[] {
  const pausedItem: CountItem = { count: t.paused, label: 'paused' }

  if (t.pausedResetsAt !== null) pausedItem.note = `limit resets ${hhmm(t.pausedResetsAt)}`

  const items: CountItem[] = [
    { count: t.stuck, label: 'stuck', tone: 'bad' },
    { count: t.running, label: 'running', tone: 'muted' },
    { count: t.waiting, label: 'waiting' },
    pausedItem,
    { count: t.done, label: 'done' },
    { count: t.idle, label: 'idle' }
  ]

  return items.filter((i) => i.count > 0)
}

/**
 * The one line an empty board shows: `nothing running`, then what is queued
 * for tonight, then when the morning summary arrives (only when it is on).
 */
export function boardEmptyLine(input: { queued: number; summaryAt: number | null }): string {
  const parts = [NOTHING_RUNNING]

  if (input.queued > 0) parts.push(`${input.queued} queued for tonight`)

  if (input.summaryAt !== null) parts.push(`summary at ${hhmm(input.summaryAt)}`)

  return parts.join(' · ')
}
