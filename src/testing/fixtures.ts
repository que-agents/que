// Fixture factories for node-side tests (logic and daemon integration).
// Realistic values, opaque ids, typed against the real shared types.
import type { HookEvent, HookEventName, StreamResult } from '@shared/protocol'
import type { QueConfig, Task, Workspace } from '@shared/types'

let sessionCounter = 0
let wsCounter = 0
let taskCounter = 0

/** A realistic Claude Code hook payload. Per-event fields go in overrides. */
export function makeHookEvent(name: HookEventName, overrides: Partial<HookEvent> = {}): HookEvent {
  sessionCounter += 1
  const sessionId = overrides.session_id ?? `sess_${sessionCounter.toString(16).padStart(6, '0')}`
  return {
    hook_event_name: name,
    session_id: sessionId,
    cwd: '/Users/dev/.que/worktrees/que/HA-1432-retry-logic',
    transcript_path: `/Users/dev/.claude/projects/-Users-dev--que-worktrees-que-HA-1432-retry-logic/${sessionId}.jsonl`,
    permission_mode: 'default',
    ...overrides
  }
}

/**
 * A stream-json `result` line from a successful headless run; override
 * subtype/is_error/stop_reason for the failure shapes.
 */
export function makeStreamResult(overrides: Partial<StreamResult> = {}): StreamResult {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 9,
    total_cost_usd: 0.74,
    duration_ms: 182_400,
    session_id: 'sess_8c1d2e',
    stop_reason: 'end_turn',
    result: 'Added exponential backoff to the uploader and covered it with tests.',
    ...overrides
  }
}

/** A fully-defaulted config: quiet 22:00-07:00, caps, a five-minute stall timeout. */
export function makeConfig(overrides: Partial<QueConfig> = {}): QueConfig {
  return {
    quiet: { start: '22:00', end: '07:00' },
    caps: { maxTurns: 40, maxCostUsd: 5 },
    stallTimeoutMs: 300_000,
    ...overrides
  }
}

/** A workspace whose branch and worktree path derive from its name, status idle. */
export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  wsCounter += 1
  const name = overrides.name ?? `ha-${1430 + wsCounter}-retry-logic`
  return {
    id: `ws_01hzx${wsCounter.toString(36).padStart(7, '0')}`,
    projectId: 'prj_01hzw7q2m4nb',
    name,
    branch: name,
    path: `/Users/dev/.que/worktrees/uploader/${name}`,
    baseRef: 'origin/main',
    status: 'idle',
    statusReason: null,
    statusAt: '2026-10-13T21:04:30.000Z',
    lastActivityAt: null,
    sessionId: null,
    createdAt: '2026-10-13T21:04:00.000Z',
    archivedAt: null,
    ...overrides
  }
}

/** A queued task with a real brief, the default caps, and an opaque id. */
export function makeTask(overrides: Partial<Task> = {}): Task {
  taskCounter += 1
  return {
    id: `tsk_01hzy${taskCounter.toString(36).padStart(7, '0')}`,
    projectId: 'prj_01hzw7q2m4nb',
    workspaceId: 'ws_01hzx3k9c2qf',
    title: 'Add retry logic to the uploader and cover it with tests',
    brief: 'Add retry logic to the uploader and cover it with tests.\nUse exponential backoff.',
    source: 'prompt',
    resumeSessionId: null,
    state: 'queued',
    reason: null,
    sessionId: null,
    pid: null,
    attempts: 0,
    costUsd: 0,
    turns: 0,
    maxTurns: 50,
    maxBudgetUsd: 5,
    permissionMode: null,
    branch: null,
    prUrl: null,
    resultText: null,
    lastActivityAt: null,
    startedAt: null,
    finishedAt: null,
    pausedUntil: null,
    createdAt: '2026-10-13T21:05:00.000Z',
    updatedAt: '2026-10-13T21:05:00.000Z',
    ...overrides
  }
}
