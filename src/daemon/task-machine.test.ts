import { describe, expect, it } from 'vitest'
import type { Task } from '@shared/types'
import { makeStreamResult, makeTask } from '../testing/fixtures'
import { nextTask, type TaskEvent } from './task-machine'

const T0 = Date.parse('2026-10-14T02:00:00.000Z')
const at = (ms: number) => new Date(ms).toISOString()
const LIMITS = { stallTimeoutMs: 300_000 }
const SESSION = '5f0c1d2e-0000-4000-8000-9a8b7c6d5e4f'

const step = (task: Task, event: TaskEvent, now = T0) => nextTask(task, event, now, LIMITS)

/** A task mid-run: started, prepared, session known, last active at T0. */
function running(overrides: Partial<Task> = {}): Task {
  return makeTask({
    state: 'running',
    attempts: 1,
    workspaceId: 'ws_01hzx3k9c2qf',
    branch: 'add-retry-logic-to-the-uploader',
    sessionId: SESSION,
    startedAt: at(T0 - 60_000),
    lastActivityAt: at(T0),
    ...overrides
  })
}

const stream = (message: Record<string, unknown>): TaskEvent => ({
  type: 'stream',
  message: message as { type: string }
})

describe('nextTask', () => {
  describe('the happy path', () => {
    it('walks queued → preparing → running → finishing → done', () => {
      let task = makeTask({ workspaceId: null })
      task = step(task, { type: 'start' })
      expect(task).toMatchObject({ state: 'preparing', attempts: 1, startedAt: at(T0) })

      task = step(task, { type: 'prepared', workspaceId: 'ws_01hzx3k9c2qf', branch: 'add-retry' })
      expect(task).toMatchObject({
        state: 'running',
        workspaceId: 'ws_01hzx3k9c2qf',
        branch: 'add-retry'
      })

      task = step(task, stream({ type: 'system', subtype: 'init', session_id: SESSION }))
      expect(task.sessionId).toBe(SESSION)

      task = step(
        task,
        stream(makeStreamResult({ num_turns: 14, total_cost_usd: 1.82, session_id: SESSION }))
      )
      expect(task).toMatchObject({
        state: 'finishing',
        turns: 14,
        costUsd: 1.82,
        resultText: 'Added exponential backoff to the uploader and covered it with tests.'
      })

      task = step(
        task,
        { type: 'finished', prUrl: 'https://github.com/rquellh/que/pull/88' },
        T0 + 9_000
      )
      expect(task).toMatchObject({
        state: 'done',
        reason: null,
        prUrl: 'https://github.com/rquellh/que/pull/88',
        finishedAt: at(T0 + 9_000)
      })
    })

    it('is done with no_changes when the finisher opened no pull request', () => {
      const next = step(running({ state: 'finishing' }), { type: 'finished', prUrl: null })

      expect(next).toMatchObject({ state: 'done', reason: 'no_changes', prUrl: null })
    })

    it('fails with the finisher step that broke', () => {
      const next = step(running({ state: 'finishing' }), { type: 'finish_failed', step: 'push' })

      expect(next).toMatchObject({ state: 'failed', reason: 'finisher:push' })
    })

    it('fails a task whose workspace could not be prepared', () => {
      const next = step(makeTask({ state: 'preparing' }), {
        type: 'prepare_failed',
        reason: 'setup_failed'
      })

      expect(next).toMatchObject({ state: 'failed', reason: 'setup_failed', finishedAt: at(T0) })
    })

    it('keeps the last assistant text as the summary until a result replaces it', () => {
      const next = step(
        running(),
        stream({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Blocked on a missing fixture.' }] }
        })
      )

      expect(next.resultText).toBe('Blocked on a missing fixture.')
    })
  })

  describe('result outcomes', () => {
    it.each([
      ['error_max_turns', 'stuck', 'max_turns'],
      ['error_max_budget_usd', 'stuck', 'max_budget'],
      ['error_during_execution', 'failed', 'execution']
    ] as const)('%s → %s(%s), with cost and turns recorded', (subtype, state, reason) => {
      const next = step(
        running(),
        stream(makeStreamResult({ subtype, is_error: true, num_turns: 40, total_cost_usd: 4.1 }))
      )

      expect(next).toMatchObject({ state, reason, turns: 40, costUsd: 4.1, finishedAt: at(T0) })
    })

    it('a startup failure is worktree_refused', () => {
      const next = step(
        running(),
        stream(
          makeStreamResult({
            subtype: 'error_during_execution',
            is_error: true,
            startup_failure_reason: 'worktree is outside the allowed directories'
          })
        )
      )

      expect(next).toMatchObject({ state: 'failed', reason: 'worktree_refused' })
    })
  })

  describe('rate limits', () => {
    it('pauses on an api_retry 429 for its retry delay', () => {
      const next = step(
        running(),
        stream({ type: 'system', subtype: 'api_retry', error_status: 429, retry_delay_ms: 30_000 })
      )

      expect(next).toMatchObject({ state: 'paused', pausedUntil: at(T0 + 30_000) })
    })

    it('pauses on an overloaded 529 for five minutes when no delay is given', () => {
      const next = step(
        running(),
        stream({ type: 'system', subtype: 'api_retry', error_status: 529 })
      )

      expect(next).toMatchObject({ state: 'paused', pausedUntil: at(T0 + 300_000) })
    })

    it('ignores retries for other errors', () => {
      const next = step(
        running(),
        stream({ type: 'system', subtype: 'api_retry', error_status: 500, retry_delay_ms: 2_000 })
      )

      expect(next.state).toBe('running')
    })

    it('pauses until resetsAt (epoch seconds) on a rejected rate_limit_event', () => {
      const resetsAt = Math.floor(Date.parse('2026-10-14T04:00:00.000Z') / 1000)

      const next = step(
        running(),
        stream({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt } })
      )

      expect(next).toMatchObject({ state: 'paused', pausedUntil: '2026-10-14T04:00:00.000Z' })
    })

    it('does not pause on an allowed rate_limit_event', () => {
      const next = step(
        running(),
        stream({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } })
      )

      expect(next.state).toBe('running')
    })

    it('pauses for five minutes on a StopFailure rate_limit hook', () => {
      const next = step(running(), {
        type: 'hook',
        payload: { hook_event_name: 'StopFailure', error: 'rate_limit' }
      })

      expect(next).toMatchObject({ state: 'paused', pausedUntil: at(T0 + 300_000) })
    })

    it('re-queues to resume the session once the pause expires, not before', () => {
      const paused = running({ state: 'paused', pausedUntil: at(T0 + 60_000) })

      expect(step(paused, { type: 'tick' }, T0 + 59_999).state).toBe('paused')
      expect(step(paused, { type: 'tick' }, T0 + 60_000)).toMatchObject({
        state: 'queued',
        resumeSessionId: SESSION,
        pausedUntil: null,
        attempts: 1
      })
    })
  })

  describe('stuck', () => {
    it.each(['permission_prompt', 'elicitation_dialog', 'agent_needs_input'])(
      'needs input on a %s notification',
      (notification_type) => {
        const next = step(running(), {
          type: 'hook',
          payload: { hook_event_name: 'Notification', notification_type }
        })

        expect(next).toMatchObject({ state: 'stuck', reason: 'needs_input' })
      }
    )

    it('ignores an idle_prompt notification but counts it as activity', () => {
      const next = step(
        running(),
        {
          type: 'hook',
          payload: { hook_event_name: 'Notification', notification_type: 'idle_prompt' }
        },
        T0 + 4_000
      )

      expect(next).toMatchObject({ state: 'running', lastActivityAt: at(T0 + 4_000) })
    })

    it('is stuck with no_heartbeat once nothing arrived for longer than the stall timeout', () => {
      const task = running()

      expect(step(task, { type: 'tick' }, T0 + 300_000).state).toBe('running')
      expect(step(task, { type: 'tick' }, T0 + 300_001)).toMatchObject({
        state: 'stuck',
        reason: 'no_heartbeat'
      })
    })

    it('any stream message or hook refreshes the heartbeat', () => {
      const task = step(
        running(),
        stream({ type: 'system', subtype: 'hook_response' }),
        T0 + 200_000
      )

      expect(step(task, { type: 'tick' }, T0 + 400_000).state).toBe('running')
    })
  })

  describe('crashes', () => {
    it('re-queues the first crash to resume its session', () => {
      const next = step(running(), { type: 'exit', code: 1, signal: null })

      expect(next).toMatchObject({
        state: 'queued',
        attempts: 2,
        resumeSessionId: SESSION,
        reason: null
      })
    })

    it('fails the retry when it crashes too', () => {
      const retry = step(step(running(), { type: 'exit', code: 1, signal: null }), {
        type: 'start'
      })

      expect(retry).toMatchObject({ state: 'preparing', attempts: 2 })
      const failed = step({ ...retry, state: 'running' }, { type: 'exit', code: 1, signal: null })
      expect(failed).toMatchObject({ state: 'failed', reason: 'crashed' })
    })

    it('ignores the exit of a run that already has an outcome', () => {
      const stuck = running({ state: 'stuck', reason: 'max_turns' })

      expect(step(stuck, { type: 'exit', code: 1, signal: null })).toMatchObject({
        state: 'stuck',
        reason: 'max_turns'
      })
    })
  })

  describe('stop and restart', () => {
    it.each(['queued', 'preparing', 'running', 'paused', 'finishing'] as const)(
      'stops a %s task',
      (state) => {
        expect(step(running({ state }), { type: 'stop' })).toMatchObject({
          state: 'stopped',
          finishedAt: at(T0)
        })
      }
    )

    it('leaves a finished task alone on stop', () => {
      const done = running({ state: 'done', prUrl: 'https://github.com/rquellh/que/pull/88' })

      expect(step(done, { type: 'stop' }).state).toBe('done')
    })

    it.each(['preparing', 'running', 'finishing'] as const)(
      're-queues a %s task after a daemon restart, resuming its session',
      (state) => {
        expect(step(running({ state }), { type: 'restart' })).toMatchObject({
          state: 'queued',
          attempts: 2,
          resumeSessionId: SESSION
        })
      }
    )

    it('re-queues a restarted task without a session to start fresh', () => {
      const next = step(running({ state: 'preparing', sessionId: null }), { type: 'restart' })

      expect(next).toMatchObject({ state: 'queued', resumeSessionId: null })
    })

    it('fails a restarted task that already used its retry', () => {
      expect(step(running({ attempts: 2 }), { type: 'restart' })).toMatchObject({
        state: 'failed',
        reason: 'daemon_restart'
      })
    })

    it('leaves queued and paused tasks to the queue on restart', () => {
      expect(step(running({ state: 'paused' }), { type: 'restart' }).state).toBe('paused')
      expect(step(makeTask(), { type: 'restart' }).state).toBe('queued')
    })
  })

  it('ignores run events outside a run', () => {
    const queued = makeTask()

    expect(step(queued, stream(makeStreamResult())).state).toBe('queued')
    expect(
      step(queued, {
        type: 'hook',
        payload: { hook_event_name: 'Notification', notification_type: 'permission_prompt' }
      }).state
    ).toBe('queued')
    expect(step(queued, { type: 'finished', prUrl: null }).state).toBe('queued')
  })

  it('never mutates its input and always returns a new object', () => {
    const prev = running()
    const before = structuredClone(prev)
    const events: TaskEvent[] = [
      { type: 'start' },
      stream(makeStreamResult()),
      { type: 'hook', payload: { hook_event_name: 'StopFailure', error: 'rate_limit' } },
      { type: 'exit', code: 1, signal: null },
      { type: 'tick' },
      { type: 'stop' },
      { type: 'restart' }
    ]

    for (const event of events) {
      const next = step(prev, event, T0 + 900_000)
      expect(next).not.toBe(prev)
    }
    expect(prev).toEqual(before)
  })
})
