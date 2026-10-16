// The task state machine, as one pure function: a task and an event in, the
// next task out. Time is passed in (`now`, epoch ms); nothing here reads the
// clock, spawns, or touches the store, and the input is never mutated.
import type { Task, TaskState } from '../shared/types'
import type { StreamEvent } from './stream-json'

/** The subset of a hook payload the task rules read. */
export interface TaskHookPayload {
  hook_event_name?: string
  notification_type?: string
  error?: string
}

export type TaskEvent =
  | { type: 'start' }
  | { type: 'prepared'; workspaceId: string; branch: string }
  /** The workspace could not be prepared (setup failed, worktree refused, ...). */
  | { type: 'prepare_failed'; reason: string }
  | { type: 'stream'; message: StreamEvent }
  | { type: 'hook'; payload: TaskHookPayload }
  | { type: 'exit'; code: number | null; signal: string | null }
  | { type: 'tick' }
  | { type: 'finished'; prUrl: string | null }
  | { type: 'finish_failed'; step: string }
  | { type: 'stop' }
  | { type: 'restart' }

export interface TaskLimits {
  stallTimeoutMs: number
}

/** States a task can still leave on its own. */
export const LIVE_STATES: ReadonlySet<TaskState> = new Set([
  'queued',
  'preparing',
  'running',
  'paused',
  'finishing'
])

/** States with a claude process (or the finisher) at work. */
export const ACTIVE_STATES: ReadonlySet<TaskState> = new Set(['preparing', 'running', 'finishing'])
const TERMINAL: ReadonlySet<TaskState> = new Set(['done', 'stuck', 'failed', 'stopped'])

/** Automatic re-queues (crash, daemon restart) stop once a task reaches this attempt. */
export const MAX_ATTEMPTS = 2

/** How long a rate-limited task waits when nothing says when the limit resets. */
export const DEFAULT_PAUSE_MS = 5 * 60_000

const RATE_LIMIT_STATUSES = new Set([429, 529])
const NEEDS_INPUT_NOTIFICATIONS = new Set(['permission_prompt', 'agent_needs_input'])

const iso = (ms: number): string => new Date(ms).toISOString()

function to(
  task: Task,
  state: TaskState,
  reason: string | null,
  now: number,
  extra: Partial<Task> = {}
): Task {
  return {
    ...task,
    ...extra,
    state,
    reason,
    finishedAt: TERMINAL.has(state) ? iso(now) : null,
    pausedUntil: state === 'paused' ? (extra.pausedUntil ?? task.pausedUntil) : null
  }
}

function pause(task: Task, until: number, now: number, extra: Partial<Task>): Task {
  return to(task, 'paused', 'rate_limit', now, { ...extra, pausedUntil: iso(until) })
}

/** Back in the queue; the next run resumes the session when there is one. */
function requeue(task: Task, now: number, attempts: number): Task {
  return to(task, 'queued', null, now, {
    attempts,
    resumeSessionId: task.sessionId ?? task.resumeSessionId
  })
}

function onResult(
  task: Task,
  m: Extract<StreamEvent, { kind: 'result' }>,
  now: number,
  seen: Partial<Task>
): Task {
  const filled: Partial<Task> = {
    ...seen,
    costUsd: m.costUsd ?? task.costUsd,
    turns: m.turns ?? task.turns,
    sessionId: m.sessionId ?? task.sessionId,
    resultText: m.text ?? task.resultText
  }

  switch (m.subtype) {
    case 'success':
      return to(task, 'finishing', null, now, filled)
    case 'error_max_turns':
      return to(task, 'stuck', 'max_turns', now, filled)
    case 'error_max_budget_usd':
      return to(task, 'stuck', 'max_budget', now, filled)
    default:
      return to(task, 'failed', m.startupFailed ? 'worktree_refused' : 'execution', now, filled)
  }
}

function onStream(task: Task, m: StreamEvent, now: number): Task {
  const seen: Partial<Task> = { lastActivityAt: iso(now) }

  switch (m.kind) {
    case 'init':
      return { ...task, ...seen, sessionId: m.sessionId }
    case 'assistant':
      return m.text === null ? { ...task, ...seen } : { ...task, ...seen, resultText: m.text }
    case 'result':
      return onResult(task, m, now, seen)
    case 'api_retry':
      if (m.httpStatus !== null && RATE_LIMIT_STATUSES.has(m.httpStatus)) {
        return pause(task, now + (m.retryDelayMs ?? DEFAULT_PAUSE_MS), now, seen)
      }

      return { ...task, ...seen }
    case 'rate_limit':
      if (m.status === 'rejected') {
        return pause(task, m.resetsAt ?? now + DEFAULT_PAUSE_MS, now, seen)
      }

      return { ...task, ...seen }
    case 'other':
      return { ...task, ...seen }
  }
}

function onHook(task: Task, p: TaskHookPayload, now: number): Task {
  const seen: Partial<Task> = { lastActivityAt: iso(now) }

  if (p.hook_event_name === 'StopFailure' && p.error === 'rate_limit') {
    return pause(task, now + DEFAULT_PAUSE_MS, now, seen)
  }

  if (
    p.hook_event_name === 'Notification' &&
    p.notification_type !== undefined &&
    (NEEDS_INPUT_NOTIFICATIONS.has(p.notification_type) ||
      p.notification_type.startsWith('elicitation_'))
  ) {
    return to(task, 'stuck', 'needs_input', now, seen)
  }

  return { ...task, ...seen }
}

/** The next task after `event`. Never mutates `task`; always returns a new object. */
export function nextTask(task: Task, event: TaskEvent, now: number, limits: TaskLimits): Task {
  switch (event.type) {
    case 'start':
      if (task.state !== 'queued') return { ...task }

      return to(task, 'preparing', null, now, {
        attempts: Math.max(task.attempts, 1),
        startedAt: task.startedAt ?? iso(now),
        lastActivityAt: iso(now)
      })
    case 'prepared':
      if (task.state !== 'preparing') return { ...task }

      return to(task, 'running', null, now, {
        workspaceId: event.workspaceId,
        branch: event.branch,
        lastActivityAt: iso(now)
      })
    case 'prepare_failed':
      if (task.state !== 'preparing') return { ...task }

      return to(task, 'failed', event.reason, now)
    case 'stream':
      return task.state === 'running' ? onStream(task, event.message, now) : { ...task }
    case 'hook':
      return task.state === 'running' ? onHook(task, event.payload, now) : { ...task }
    case 'exit':
      // A run that ends without a result crashed; one automatic retry resumes it.
      if (task.state !== 'running') return { ...task }

      if (task.attempts < MAX_ATTEMPTS) return requeue(task, now, task.attempts + 1)

      return to(task, 'failed', 'crashed', now)
    case 'tick': {
      if (task.state === 'running') {
        const last = Date.parse(task.lastActivityAt ?? task.startedAt ?? task.createdAt)

        if (now - last > limits.stallTimeoutMs) return to(task, 'stuck', 'no_heartbeat', now)
      }

      if (task.state === 'paused' && task.pausedUntil && now >= Date.parse(task.pausedUntil)) {
        return requeue(task, now, task.attempts)
      }

      return { ...task }
    }

    case 'finished':
      if (task.state !== 'finishing') return { ...task }

      return to(task, 'done', event.prUrl ? null : 'no_changes', now, { prUrl: event.prUrl })
    case 'finish_failed':
      if (task.state !== 'finishing') return { ...task }

      return to(task, 'failed', `finisher:${event.step}`, now)
    case 'stop':
      return LIVE_STATES.has(task.state) ? to(task, 'stopped', null, now) : { ...task }
    case 'restart':
      if (!ACTIVE_STATES.has(task.state)) return { ...task }

      if (task.attempts >= MAX_ATTEMPTS) return to(task, 'failed', 'daemon_restart', now)

      return requeue(task, now, task.attempts + 1)
  }
}
