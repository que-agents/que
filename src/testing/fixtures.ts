// Fixture factories for node-side tests (logic and daemon integration).
// Realistic values, opaque ids, typed against the real shared types.
import type { HookEvent, HookEventName, StreamResult } from '@shared/protocol'
import { defaultConfig, defaultQuietHours } from '@shared/config'
import type {
  PrCheck,
  PrThreadEntry,
  QuietHoursConfig,
  Task,
  Ticket,
  UserConfig,
  Workspace
} from '@shared/types'

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
    cwd: '/Users/dev/.que/worktrees/que/APP-1432-retry-logic',
    transcript_path: `/Users/dev/.claude/projects/-Users-dev--que-worktrees-que-APP-1432-retry-logic/${sessionId}.jsonl`,
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

/** A fully-defaulted user config (quiet hours 19:00-07:00, caps, a five-minute stall timeout). */
export function makeConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  return { ...defaultConfig({ queHome: '/Users/dev/.que' }), ...overrides }
}

/** Quiet hours as configured: the defaults with overrides. */
export function makeQuietHours(overrides: Partial<QuietHoursConfig> = {}): QuietHoursConfig {
  return { ...defaultQuietHours(), ...overrides }
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
    prUrl: null,
    pr: null,
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

/** A ticket assigned to the user, as tickets.list reports it. */
export function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    key: 'APP-1432',
    summary: 'Add retry logic to the uploader',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    priority: 'Medium',
    type: 'Story',
    level: 'standard',
    parentKey: null,
    assigned: true,
    assignee: 'Ryan',
    projectKey: 'APP',
    projectName: 'Uploader',
    url: 'https://example.atlassian.net/browse/APP-1432',
    labels: [],
    updatedAt: '2026-10-14T01:12:00.000Z',
    syncedAt: '2026-10-14T01:15:00.000Z',
    workspaceId: null,
    ...overrides
  }
}

/** One check run on a pull request's head. */
export function makePrCheck(overrides: Partial<PrCheck> = {}): PrCheck {
  return {
    name: 'build',
    source: 'CI',
    state: 'passing',
    url: 'https://github.com/rquellh/que/actions/runs/1',
    startedAt: '2026-10-14T01:00:00.000Z',
    completedAt: '2026-10-14T01:04:00.000Z',
    ...overrides
  }
}

let prEntryCounter = 0

/** One entry of a pull request's conversation: an issue comment by default. */
export function makePrThreadEntry(overrides: Partial<PrThreadEntry> = {}): PrThreadEntry {
  prEntryCounter += 1
  return {
    id: `c${prEntryCounter}`,
    kind: 'comment',
    author: 'reviewer',
    body: 'Looks good, one question about the retry cap.',
    at: '2026-10-14T02:00:00.000Z',
    url: `https://github.com/rquellh/que/pull/41#issuecomment-${prEntryCounter}`,
    state: null,
    path: null,
    line: null,
    hunk: null,
    ...overrides
  }
}
