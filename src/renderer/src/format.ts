// Pure display rules for the renderer: badge labels and tones, and the order
// things are listed in. Money and durations are in shared/format.
import type {
  PullRequest,
  ReportGroup,
  Task,
  TaskState,
  WorkspaceStatus
} from '../../preload/index.d'
import { LIVE_STATES } from '../../shared/types'

export type Tone = 'neutral' | 'busy' | 'attention' | 'bad' | 'good' | 'muted'

const STATUS: Record<WorkspaceStatus, { label: string; tone: Tone }> = {
  preparing: { label: 'preparing', tone: 'muted' },
  idle: { label: 'idle', tone: 'neutral' },
  working: { label: 'working', tone: 'busy' },
  needs_input: { label: 'needs input', tone: 'attention' },
  stuck: { label: 'stuck', tone: 'bad' },
  exited: { label: 'exited', tone: 'muted' }
}

const TASK: Record<TaskState, { label: string; tone: Tone }> = {
  queued: { label: 'queued', tone: 'neutral' },
  preparing: { label: 'preparing', tone: 'busy' },
  running: { label: 'running', tone: 'busy' },
  paused: { label: 'paused', tone: 'attention' },
  finishing: { label: 'finishing', tone: 'busy' },
  done: { label: 'done', tone: 'good' },
  stuck: { label: 'stuck', tone: 'bad' },
  failed: { label: 'failed', tone: 'bad' },
  stopped: { label: 'stopped', tone: 'muted' }
}

export function statusBadge(status: WorkspaceStatus): { label: string; tone: Tone } {
  return STATUS[status]
}

export function taskBadge(state: TaskState): { label: string; tone: Tone } {
  return TASK[state]
}

/** True while a task can still be stopped. */
export function isLiveTask(state: TaskState): boolean {
  return LIVE_STATES.has(state)
}

/** The newest task that ran (or runs) in each workspace. */
export function latestTasks(tasks: Record<string, Task>): Map<string, Task> {
  const out = new Map<string, Task>()

  for (const t of Object.values(tasks)) {
    if (!t.workspaceId) continue
    const prev = out.get(t.workspaceId)

    if (!prev || t.createdAt > prev.createdAt) out.set(t.workspaceId, t)
  }

  return out
}

/** Newest first, ties broken by id so the order is stable. */
export function newestFirst(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
  )
}

/** The report's sections, in reading order. */
export const REPORT_GROUPS: ReadonlyArray<{ group: ReportGroup; title: string }> = [
  { group: 'done', title: 'Done' },
  { group: 'stuck', title: 'Stuck' },
  { group: 'failed', title: 'Failed' },
  { group: 'paused', title: 'Paused' },
  { group: 'running', title: 'Running' },
  { group: 'queued', title: 'Queued' },
  { group: 'stopped', title: 'Stopped' }
]

const REVIEW_TEXT = {
  approved: 'approved',
  changes_requested: 'changes requested',
  review_required: 'review required'
} as const

/** The chip for a pull request: `#41`, a tone, and a tooltip sentence. */
export function prBadge(pr: PullRequest) {
  let tone: Tone

  if (pr.state === 'merged') tone = 'good'
  else if (pr.state === 'closed') tone = 'muted'
  else if (pr.checks === 'failing') tone = 'bad'
  else if (pr.review === 'changes_requested') tone = 'attention'
  else if (pr.state === 'draft') tone = 'neutral'
  else if (pr.review === 'approved' && (pr.checks === 'passing' || pr.checks === 'none'))
    tone = 'good'
  else tone = 'busy'
  const parts: string[] = [pr.state]

  if (pr.checks !== 'none') parts.push(`checks ${pr.checks}`)

  if (pr.review) parts.push(REVIEW_TEXT[pr.review])

  return { label: `#${pr.number}`, tone, title: `PR #${pr.number}: ${parts.join(', ')}` }
}
