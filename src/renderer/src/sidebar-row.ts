// How a sidebar row reads at rest and under the pointer: the dot (or the working
// mark), its tone, the weight of the name, the background mark, and the status word. Pure rules over the
// workspace and its newest task; Sidebar.tsx draws them. docs/design.md "Sidebar".
import type { Task, Workspace } from '../../preload/index.d'
import { formatAge } from '../../shared/format'
import { ACTIVE_STATES } from '../../shared/types'
import { isLiveTask, prNumberOf, statusBadge, taskBadge, type Tone } from './format'

/** The name's text colour: `--fg` when it needs you, `--fg-secondary` while working, else `--fg-faint`. */
export type Weight = 'fg' | 'secondary' | 'faint'

export interface RowTone {
  /** What the row reports as `data-status`: a live task's state, `done` for a finished task, else the workspace's status. */
  status: string
  /** The dot's tone. */
  tone: Tone
  /** The working mark (four rippling accent dots) instead of the dot. */
  working: boolean
  /** Finished since the app last had it selected. */
  unseen: boolean
  weight: Weight
  /**
   * The distinct kinds running in the background, in the daemon's order, while the row is idle
   * with no live task; else none. The engine leaves only shells and monitors on an idle row, so
   * idle with background work is the whole rule. Non-empty draws `›_` at the row's right end.
   */
  background: string[]
}

/**
 * Whether a workspace has something new to look at: it finished (a turn ended, or its task
 * did) since the app last had it selected in a focused window. True when `finishedAt` is
 * later than `seenAt` (or it finished and was never seen).
 */
export function unseenDone(ws: Pick<Workspace, 'finishedAt' | 'seenAt'>): boolean {
  const finished = ws.finishedAt ? Date.parse(ws.finishedAt) : Number.NaN

  if (!Number.isFinite(finished)) return false
  const seen = ws.seenAt ? Date.parse(ws.seenAt) : Number.NaN

  return !Number.isFinite(seen) || finished > seen
}

/** Statuses that already mean "now": a fresh finish does not paint over them. */
const URGENT: ReadonlySet<string> = new Set(['working', 'needs_input', 'stuck'])

/**
 * The row's look. A live task speaks for its workspace; otherwise the workspace's status,
 * green with its name at full strength while it finished unseen. The selected row is
 * looked at, so never unseen, and always reads `--fg`.
 */
export function rowTone(ws: Workspace, task?: Task, selected = false): RowTone {
  if (task && isLiveTask(task.state)) {
    return {
      status: task.state,
      tone: taskBadge(task.state).tone,
      working: ACTIVE_STATES.has(task.state),
      unseen: false,
      weight: selected ? 'fg' : 'secondary',
      background: []
    }
  }

  const interactive = ws.status === 'working' || ws.status === 'needs_input'
  const status = task?.state === 'done' && !interactive ? 'done' : ws.status
  const unseen = !selected && !URGENT.has(ws.status) && unseenDone(ws)
  const working = ws.status === 'working'

  return {
    status,
    tone: unseen ? 'good' : statusBadge(ws.status).tone,
    working,
    unseen,
    weight: nameWeight(
      selected || unseen || ws.status === 'needs_input' || ws.status === 'stuck',
      working
    ),
    background: ws.status === 'idle' ? [...new Set(ws.backgroundTasks.map((t) => t.kind))] : []
  }
}

function nameWeight(needsYou: boolean, working: boolean): Weight {
  if (needsYou) return 'fg'

  return working ? 'secondary' : 'faint'
}

/** The word under the pointer, and its tone when it takes one (needs input, stuck, paused). */
export interface HoverWord {
  word: string
  tone: Tone | null
}

export function hoverWord(
  ws: Workspace,
  task: Task | undefined,
  look: RowTone,
  now: number
): HoverWord {
  const toned = look.tone === 'attention' || look.tone === 'bad' ? look.tone : null

  if (look.unseen) return { word: `done · ${finishedAsk(ws, task, now)}`, tone: null }

  if (task && isLiveTask(task.state)) return { word: taskBadge(task.state).label, tone: toned }

  if (look.status === 'done') return { word: 'done', tone: null }

  if (look.background.length > 0) {
    return { word: ['idle', ...look.background].join(' · '), tone: null }
  }

  return { word: statusBadge(ws.status).label, tone: toned }
}

/** What a fresh finish asks of you: the task's pull request or lack of one, else how long ago. */
function finishedAsk(ws: Workspace, task: Task | undefined, now: number): string {
  const byTask =
    task?.state === 'done' &&
    task.finishedAt !== null &&
    ws.finishedAt !== null &&
    Date.parse(task.finishedAt) >= Date.parse(ws.finishedAt)

  if (byTask && task.prUrl) return `draft PR #${prNumberOf(task.prUrl)}`

  if (byTask && task.reason === 'no_changes') return 'no changes'

  return formatAge(ws.finishedAt, now, ' ago')
}
