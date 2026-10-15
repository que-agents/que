// Fixture factories for renderer tests. Same shapes as src/testing/fixtures.ts
// (kept separate: renderer tests never import node-side test code).
import type {
  Project,
  QuietState,
  Task,
  TermInfo,
  UserConfig,
  Workspace
} from '../../../preload/index.d'

let wsCounter = 0
let taskCounter = 0
let termCounter = 0

/** The uploader repository, the project every fixture workspace belongs to by default. */
export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'prj_01hzw7q2m4nb',
    name: 'uploader',
    path: '/Users/dev/code/uploader',
    defaultBranch: 'main',
    createdAt: '2026-10-13T20:58:00.000Z',
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

/** A live terminal as term.list reports it, with a daemon-style UUID id. */
export function makeTermInfo(overrides: Partial<TermInfo> = {}): TermInfo {
  termCounter += 1
  const n = termCounter.toString(16).padStart(4, '0')
  return {
    id: `6f1c2a7e-${n}-4b8d-9a3e-5c0d7e21${n}`,
    name: 'zsh',
    cwd: '/Users/dev/code/uploader',
    cols: 80,
    rows: 24,
    pid: 51_200 + termCounter,
    alive: true,
    createdAt: `2026-10-13T21:${(10 + termCounter).toString().padStart(2, '0')}:00.000Z`,
    ...overrides
  }
}

/** Work hours: quiet hours on, the next window starting at 19:00 local. */
export function makeQuietState(overrides: Partial<QuietState> = {}): QuietState {
  return {
    enabled: true,
    inQuietHours: false,
    windowStart: null,
    windowEnd: null,
    nextBoundary: new Date(2026, 9, 13, 19, 0).toISOString(),
    unlockedUntil: null,
    unlockMinutes: 20,
    ...overrides
  }
}

/** The parsed defaults, as config.get reports them. */
export function makeUserConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  return {
    worktreeRoot: '/Users/dev/.que/worktrees',
    stallTimeoutMinutes: 5,
    statusPollSeconds: 10,
    repos: {},
    concurrency: 2,
    maxTurns: 50,
    maxBudgetUsd: 5,
    allowBypassPermissions: false,
    protectedBranches: ['main', 'master', 'release'],
    quietHours: {
      enabled: true,
      default: { start: '19:00', end: '07:00' },
      days: {},
      unlockMinutes: 20
    },
    notifications: { chimeOnComplete: true, chimeOnNeedsInput: false, morningSummary: false },
    ...overrides
  }
}
