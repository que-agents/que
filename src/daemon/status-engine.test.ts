import { describe, expect, it } from 'vitest'
import { makeHookEvent, makeTask, makeWorkspace } from '../testing/fixtures'
import {
  AGENTS_JSON_MIN_AGE_MS,
  initialState,
  quietTrayTitle,
  reduce,
  type StatusState,
  summarize,
  traySummary,
  trayTitle
} from './status-engine'

// Local wall-clock instants on 14 Oct 2026; the engine only ever sees `now`.
const T0 = new Date(2026, 9, 14, 10, 0).getTime()
const STALL = { stallTimeoutMs: 300_000 }

const idle: StatusState = { ...initialState(T0, 'idle') }
const working: StatusState = {
  ...initialState(T0, 'working'),
  lastActivityAt: T0,
  hookAt: T0,
  sessionId: 'b3c1d2e4-0000-4000-8000-1a2b3c4d5e6f'
}

function hook(state: StatusState, ...args: Parameters<typeof makeHookEvent>) {
  const payload = makeHookEvent(...args)
  return reduce(state, { kind: 'hook', event: payload.hook_event_name, payload }, T0 + 1_000)
}

describe('reduce', () => {
  describe('transitions', () => {
    it('goes idle on SessionStart and records the session id', () => {
      const next = hook(initialState(T0), 'SessionStart', {
        session_id: '0f9e8d7c-0000-4000-8000-6b5a4c3d2e1f',
        source: 'startup'
      })

      expect(next).toMatchObject({
        status: 'idle',
        sessionId: '0f9e8d7c-0000-4000-8000-6b5a4c3d2e1f',
        statusAt: T0 + 1_000,
        hookAt: T0 + 1_000
      })
    })

    it.each([
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PreCompact',
      'SubagentStart',
      'SubagentStop'
    ] as const)('goes working on %s and refreshes the activity time', (event) => {
      const next = hook(idle, event, { tool_name: 'Bash' })

      expect(next).toMatchObject({ status: 'working', reason: null, lastActivityAt: T0 + 1_000 })
    })

    it.each(['permission_prompt', 'elicitation_dialog', 'agent_needs_input'])(
      'needs input on a %s notification',
      (notification_type) => {
        const next = hook(working, 'Notification', {
          notification_type,
          message: 'Claude needs your permission to use Bash'
        })

        expect(next.status).toBe('needs_input')
      }
    )

    it('needs input on PermissionRequest', () => {
      expect(hook(working, 'PermissionRequest', { tool_name: 'Bash' }).status).toBe('needs_input')
    })

    it('goes idle on an idle_prompt notification and on Stop', () => {
      const asked = { ...working, status: 'needs_input' as const }

      expect(
        hook(asked, 'Notification', {
          notification_type: 'idle_prompt',
          message: 'Claude is waiting for your input'
        }).status
      ).toBe('idle')
      expect(hook(working, 'Stop', { last_assistant_message: 'Done.' }).status).toBe('idle')
    })

    it('leaves the status alone for other notifications', () => {
      const next = hook(working, 'Notification', { notification_type: 'auth_success' })

      expect(next.status).toBe('working')
      expect(next.statusAt).toBe(working.statusAt)
    })

    it('is stuck with the error kind on StopFailure', () => {
      const next = hook(working, 'StopFailure', {
        error: 'rate_limit',
        error_details: 'API Error: 429'
      })

      expect(next).toMatchObject({ status: 'stuck', reason: 'error:rate_limit' })
    })

    it('has exited on SessionEnd and when the last terminal exits', () => {
      expect(hook(idle, 'SessionEnd', { reason: 'prompt_input_exit' }).status).toBe('exited')
      expect(reduce(working, { kind: 'terminal_exit' }, T0 + 1_000).status).toBe('exited')
    })

    it('ignores subagent events', () => {
      const next = hook(idle, 'PreToolUse', { agent_id: 'agent_7c21', agent_type: 'Explore' })

      expect(next).toEqual(idle)
    })
  })

  describe('clock', () => {
    it('marks a working session stuck once nothing happened for the stall timeout', () => {
      expect(reduce(working, { kind: 'tick' }, T0 + 300_000, STALL).status).toBe('working')

      const stalled = reduce(working, { kind: 'tick' }, T0 + 300_001, STALL)

      expect(stalled).toMatchObject({
        status: 'stuck',
        reason: 'no_heartbeat',
        statusAt: T0 + 300_001
      })
    })

    it('never stalls a session that is idle or waiting for input', () => {
      const waiting = { ...working, status: 'needs_input' as const }

      expect(reduce(idle, { kind: 'tick' }, T0 + 3_600_000, STALL).status).toBe('idle')
      expect(reduce(waiting, { kind: 'tick' }, T0 + 3_600_000, STALL).status).toBe('needs_input')
    })

    it('clears a stall on the next hook event', () => {
      const stalled = reduce(working, { kind: 'tick' }, T0 + 400_000, STALL)

      const next = reduce(
        stalled,
        { kind: 'hook', event: 'PostToolUse', payload: makeHookEvent('PostToolUse') },
        T0 + 401_000
      )

      expect(next).toMatchObject({ status: 'working', reason: null })
    })
  })

  describe('claude agents --json cross-check', () => {
    const entry = (status: string) => ({
      kind: 'agents_json' as const,
      entry: { cwd: '/Users/dev/.que/worktrees/uploader/app-1432-retry-logic', status }
    })
    const old = T0 + AGENTS_JSON_MIN_AGE_MS + 1

    it('is ignored while the hook-derived state is fresh', () => {
      expect(reduce(working, entry('waiting_for_input'), T0 + AGENTS_JSON_MIN_AGE_MS).status).toBe(
        'working'
      )
    })

    it.each([
      ['waiting_for_input', 'needs_input'],
      ['blocked', 'needs_input'],
      ['idle', 'idle'],
      ['running', 'working']
    ] as const)('maps %s to %s once the hook state is older than 30 s', (status, expected) => {
      const from = {
        ...working,
        status: expected === 'working' ? ('idle' as const) : working.status
      }

      expect(reduce(from, entry(status), old).status).toBe(expected)
    })

    it('applies to a workspace no hook has reported from yet', () => {
      expect(reduce(idle, entry('waiting'), T0 + 1).status).toBe('needs_input')
    })
  })

  describe('purity', () => {
    it('returns a new state and never mutates its input', () => {
      const before = structuredClone(working)

      const next = reduce(working, { kind: 'tick' }, T0 + 900_000, STALL)

      expect(next).not.toBe(working)
      expect(working).toEqual(before)
    })
  })
})

describe('summarize and trayTitle', () => {
  it('counts workspaces per status and formats the tray title', () => {
    const summary = summarize([
      { status: 'working' },
      { status: 'working' },
      { status: 'working' },
      { status: 'needs_input' },
      { status: 'idle' },
      { status: 'preparing' }
    ])

    expect(summary).toEqual({
      working: 3,
      idle: 1,
      needs_input: 1,
      stuck: 0,
      exited: 0,
      preparing: 1
    })
    expect(trayTitle(summary)).toBe('● 3 ▸ 1 ✕ 0')
  })
})

describe('traySummary', () => {
  const retry = makeWorkspace({
    id: 'ws_01hzx3k9c2qf',
    name: 'app-1432-retry-logic',
    status: 'idle'
  })
  const board = makeWorkspace({
    id: 'ws_01hzx4m1p8rt',
    name: 'app-1440-quiet-board',
    status: 'needs_input'
  })

  it('counts a workspace once, as working while a task runs in it', () => {
    const summary = traySummary(
      [retry, board],
      [makeTask({ workspaceId: retry.id, state: 'running' })]
    )

    expect(trayTitle(summary)).toBe('● 1 ▸ 1 ✕ 0')
    expect(summary.idle).toBe(0)
  })

  it('counts a stuck task as a stuck workspace', () => {
    const summary = traySummary([retry], [makeTask({ workspaceId: retry.id, state: 'stuck' })])

    expect(trayTitle(summary)).toBe('● 0 ▸ 0 ✕ 1')
  })

  it('counts a task still preparing its workspace as working on its own', () => {
    const summary = traySummary([], [makeTask({ workspaceId: null, state: 'preparing' })])

    expect(summary.working).toBe(1)
  })

  it('ignores finished, queued, and paused tasks and stuck ones whose workspace is gone', () => {
    const summary = traySummary(
      [retry],
      [
        makeTask({ workspaceId: retry.id, state: 'done' }),
        makeTask({ workspaceId: retry.id, state: 'queued' }),
        makeTask({ workspaceId: retry.id, state: 'paused' }),
        makeTask({ workspaceId: 'ws_01hzx9gone00', state: 'stuck' })
      ]
    )

    expect(trayTitle(summary)).toBe('● 0 ▸ 0 ✕ 0')
    expect(summary.idle).toBe(1)
  })
})

describe('quietTrayTitle', () => {
  const summary = summarize([
    { status: 'working' },
    { status: 'working' },
    { status: 'working' },
    { status: 'needs_input' }
  ])
  const now = new Date(2026, 9, 14, 2, 0).getTime()
  const quiet = {
    inQuietHours: true,
    unlockedUntil: new Date(now + 14 * 60_000 + 32_000).toISOString()
  }

  it('leads with the unlock countdown while an unlock runs', () => {
    expect(quietTrayTitle(summary, quiet, now)).toBe('🔓 14:32 · ● 3 ▸ 1 ✕ 0')
    expect(quietTrayTitle(summary, quiet, now + 14 * 60_000 + 31_000)).toBe(
      '🔓 00:01 · ● 3 ▸ 1 ✕ 0'
    )
  })

  it('is the plain counts while quiet and locked, and in work hours', () => {
    expect(quietTrayTitle(summary, { inQuietHours: true, unlockedUntil: null }, now)).toBe(
      '● 3 ▸ 1 ✕ 0'
    )
    expect(quietTrayTitle(summary, { inQuietHours: false, unlockedUntil: null }, now)).toBe(
      '● 3 ▸ 1 ✕ 0'
    )
    expect(quietTrayTitle(summary, null, now)).toBe('● 3 ▸ 1 ✕ 0')
  })
})
