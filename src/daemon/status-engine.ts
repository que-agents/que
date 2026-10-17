// The status engine's rules, as pure functions: hook events, terminal exits,
// clock ticks, and `claude agents --json` entries in; a workspace status out.
// Time is always passed in (`now`, epoch ms); nothing here reads the clock.
import { formatMinSec } from '../shared/format'
import type { StatusSummary, TaskState, WorkspaceStatus } from '../shared/types'

export interface StatusState {
  status: WorkspaceStatus
  /** Set only while stuck: `no_heartbeat`, `setup_failed`, `error:<kind>`. */
  reason: string | null
  /** When status or reason last changed. */
  statusAt: number
  /** Last sign of work (a working hook, or transcript growth seen by the caller). */
  lastActivityAt: number | null
  sessionId: string | null
  /** When a main-session hook event last arrived; null if none ever did. */
  hookAt: number | null
}

/** The subset of a hook payload the rules read. */
export interface HookPayload {
  session_id?: string
  agent_id?: string
  notification_type?: string
  error?: string
}

/** One entry of `claude agents --json`. */
export interface AgentEntry {
  cwd?: string
  status?: string
}

export type StatusInput =
  | { kind: 'hook'; event: string; payload: HookPayload }
  | { kind: 'terminal_exit' }
  | { kind: 'tick' }
  | { kind: 'agents_json'; entry: AgentEntry }

export interface ReduceOptions {
  stallTimeoutMs: number
}

export const DEFAULT_STALL_TIMEOUT_MS = 5 * 60_000

/** `claude agents --json` may only override hook-derived state older than this. */
export const AGENTS_JSON_MIN_AGE_MS = 30_000

const WORKING_EVENTS = new Set([
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PreCompact',
  'SubagentStart',
  'SubagentStop'
])

const NEEDS_INPUT_NOTIFICATIONS = new Set([
  'permission_prompt',
  'elicitation_dialog',
  'agent_needs_input'
])

export function initialState(now: number, status: WorkspaceStatus = 'preparing'): StatusState {
  return {
    status,
    reason: null,
    statusAt: now,
    lastActivityAt: null,
    sessionId: null,
    hookAt: null
  }
}

function transition(
  state: StatusState,
  status: WorkspaceStatus,
  reason: string | null,
  now: number,
  extra: Partial<StatusState> = {}
): StatusState {
  const changed = state.status !== status || state.reason !== reason

  return { ...state, ...extra, status, reason, statusAt: changed ? now : state.statusAt }
}

function onHook(state: StatusState, event: string, p: HookPayload, now: number): StatusState {
  // Subagent events are recorded by the caller but never move the workspace.
  if (p.agent_id) return { ...state }
  const seen: Partial<StatusState> = { hookAt: now, sessionId: p.session_id ?? state.sessionId }

  if (WORKING_EVENTS.has(event)) {
    return transition(state, 'working', null, now, { ...seen, lastActivityAt: now })
  }

  switch (event) {
    case 'SessionStart':
    case 'Stop':
      return transition(state, 'idle', null, now, seen)
    case 'PermissionRequest':
      return transition(state, 'needs_input', null, now, seen)
    case 'Notification':
      if (p.notification_type && NEEDS_INPUT_NOTIFICATIONS.has(p.notification_type)) {
        return transition(state, 'needs_input', null, now, seen)
      }

      if (p.notification_type === 'idle_prompt') return transition(state, 'idle', null, now, seen)

      return { ...state, ...seen }
    case 'StopFailure':
      return transition(state, 'stuck', `error:${p.error || 'unknown'}`, now, seen)
    case 'SessionEnd':
      return transition(state, 'exited', null, now, seen)
    default:
      return { ...state, ...seen }
  }
}

function onAgentsEntry(state: StatusState, entry: AgentEntry, now: number): StatusState {
  if (state.hookAt !== null && now - state.hookAt <= AGENTS_JSON_MIN_AGE_MS) return { ...state }
  const s = (entry.status ?? '').toLowerCase()

  if (s.includes('wait') || s.includes('blocked') || s.includes('input')) {
    return transition(state, 'needs_input', null, now)
  }

  if (s === 'idle') return transition(state, 'idle', null, now)

  if (s.includes('working') || s.includes('running')) {
    return transition(state, 'working', null, now, { lastActivityAt: now })
  }

  return { ...state }
}

/** The next status of one workspace. Never mutates `state`. */
export function reduce(
  state: StatusState,
  input: StatusInput,
  now: number,
  opts: ReduceOptions = { stallTimeoutMs: DEFAULT_STALL_TIMEOUT_MS }
): StatusState {
  switch (input.kind) {
    case 'hook':
      return onHook(state, input.event, input.payload, now)
    case 'terminal_exit':
      return transition(state, 'exited', null, now)
    case 'tick': {
      if (state.status !== 'working') return { ...state }
      const last = state.lastActivityAt ?? state.statusAt

      if (now - last > opts.stallTimeoutMs) return transition(state, 'stuck', 'no_heartbeat', now)

      return { ...state }
    }

    case 'agents_json':
      return onAgentsEntry(state, input.entry, now)
  }
}

const STATUSES: WorkspaceStatus[] = [
  'working',
  'idle',
  'needs_input',
  'stuck',
  'exited',
  'preparing'
]

/** Workspace counts per status. */
export function summarize(workspaces: ReadonlyArray<{ status: WorkspaceStatus }>): StatusSummary {
  const s = Object.fromEntries(STATUSES.map((k) => [k, 0])) as StatusSummary

  for (const w of workspaces) s[w.status] += 1

  return s
}

/** The menu-bar title: working, needing input, stuck. */
export function trayTitle(s: StatusSummary): string {
  return `● ${s.working} ▸ ${s.needs_input} ✕ ${s.stuck}`
}

const TASK_WORKING: ReadonlySet<TaskState> = new Set(['preparing', 'running', 'finishing'])

/**
 * Workspace counts for the tray, with overnight tasks folded in: a task that is
 * running counts its workspace as working (or itself, before it has one), and
 * a stuck task counts its workspace as stuck. Each workspace counts once.
 */
export function traySummary(
  workspaces: ReadonlyArray<{ id: string; status: WorkspaceStatus }>,
  tasks: ReadonlyArray<{ workspaceId: string | null; state: TaskState }>
): StatusSummary {
  const effective = new Map(workspaces.map((w) => [w.id, w.status]))
  const unplaced: WorkspaceStatus[] = []

  for (const t of tasks) {
    const status: WorkspaceStatus | null = TASK_WORKING.has(t.state)
      ? 'working'
      : t.state === 'stuck'
        ? 'stuck'
        : null

    if (!status) continue

    if (t.workspaceId && effective.has(t.workspaceId)) effective.set(t.workspaceId, status)
    else if (status === 'working') unplaced.push(status)
  }

  return summarize([...effective.values(), ...unplaced].map((status) => ({ status })))
}

/**
 * The menu-bar title with quiet hours folded in: while an unlock runs it
 * leads with the countdown (`🔓 14:32 · ● 3 ▸ 1 ✕ 0`), otherwise it is the
 * plain counts.
 */
export function quietTrayTitle(
  s: StatusSummary,
  quiet: { inQuietHours: boolean; unlockedUntil: string | null } | null,
  now: number
): string {
  const base = trayTitle(s)

  if (!quiet?.inQuietHours || !quiet.unlockedUntil) return base

  return `🔓 ${formatMinSec(Date.parse(quiet.unlockedUntil) - now)} · ${base}`
}
