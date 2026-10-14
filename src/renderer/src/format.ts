// Pure display rules for the renderer: badge labels and tones, money and
// durations, and the order things are listed in.
import type { ReportGroup, Task, TaskState, WorkspaceStatus } from '../../preload/index.d'

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

const LIVE: ReadonlySet<TaskState> = new Set([
  'queued',
  'preparing',
  'running',
  'paused',
  'finishing'
])

/** True while a task can still be stopped. */
export function isLiveTask(state: TaskState): boolean {
  return LIVE.has(state)
}

/** `$0.42`; whole cents, never `$0.4200001`. */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

/** `42s`, `3m 05s`, `2h 07m`. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
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
  { group: 'stopped', title: 'Stopped' },
  { group: 'paused', title: 'Paused' },
  { group: 'running', title: 'Running' },
  { group: 'queued', title: 'Queued' }
]
