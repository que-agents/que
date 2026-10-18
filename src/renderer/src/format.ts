// Pure display rules for the renderer: badge labels and tones, and the order
// things are listed in. Money and durations are in shared/format.
import type { PullRequest, Task, TaskState, WorkspaceStatus } from '../../preload/index.d'
import { prUrlNumber } from '../../shared/pr-url'
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

const REVIEW_TEXT = {
  approved: 'approved',
  changes_requested: 'changes requested',
  review_required: 'review required'
} as const

/** A pull request's tone and the words the workspace card writes for it, from one ladder. */
function prTone(pr: PullRequest): [Tone, string] {
  if (pr.state === 'merged') return ['good', 'merged']

  if (pr.state === 'closed') return ['muted', 'closed']

  if (pr.checks === 'failing') return ['bad', `${pr.state} · checks failing`]

  if (pr.review === 'changes_requested') return ['attention', REVIEW_TEXT.changes_requested]

  if (pr.state === 'draft') return ['neutral', 'draft']
  const plain = pr.checks === 'none' ? pr.state : `${pr.state} · checks ${pr.checks}`

  if (pr.review === 'approved' && (pr.checks === 'passing' || pr.checks === 'none'))
    return ['good', plain]

  return ['busy', plain]
}

/**
 * The chip for a pull request: `#41`, a tone, a tooltip sentence, and the card's words for
 * its state (`text`).
 */
export function prBadge(pr: PullRequest) {
  const [tone, text] = prTone(pr)
  const parts: string[] = [pr.state]

  if (pr.checks !== 'none') parts.push(`checks ${pr.checks}`)

  if (pr.review) parts.push(REVIEW_TEXT[pr.review])

  return { label: `#${pr.number}`, tone, text, title: `PR #${pr.number}: ${parts.join(', ')}` }
}

/** A pull request's number from its URL (`…/pull/<n>`); undefined without a URL. */
export function prNumberOf(prUrl: string | null | undefined): string | undefined {
  const n = prUrlNumber(prUrl)

  return n === null ? undefined : String(n)
}
