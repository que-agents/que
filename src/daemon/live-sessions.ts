// Interactive Claude sessions that come back after a daemon restart. While the
// daemon runs it keeps a record of every workspace terminal in which a session
// is live, as the hooks report it: written on SessionStart, cleared on
// SessionEnd, when the terminal exits, and when it is killed. The record is
// persisted as it changes, so a crash leaves it as current as a clean stop.
// The next daemon takes the record at start: each entry is consumed once and,
// unless its workspace is gone, reopened as a terminal in the workspace that
// types `claude --resume <session>`. While quiet hours are locked nothing is
// opened; the entries wait for the unlock (or the next start).
import type { HookEvent } from '../shared/protocol'
import type { Workspace } from '../shared/types'
import { errorMessage } from '../shared/errors.decode'
import { decodeLiveSessions } from './live-sessions.decode'
import type { Store } from './store'

/** A workspace terminal in which a Claude session is live. */
export interface LiveSession {
  workspaceId: string
  terminalId: string
  sessionId: string
}

/** What changes the record: a hook from a session, or a terminal that ended or was killed. */
export type LiveInput =
  | {
      kind: 'hook'
      workspaceId: string
      /** The terminal the hook fired in (QUE_TERMINAL_ID), when it fired in one. */
      terminalId?: string
      /** Set for a headless task run, whose recovery the queue owns. */
      taskId?: string
      payload: HookEvent
    }
  | { kind: 'terminal_gone'; terminalId: string }

/**
 * The record after one input. Only a main session's start in a workspace
 * terminal adds an entry (replacing the terminal's earlier one); its end, or
 * the terminal going away, removes it. Never mutates `live`; returns it
 * unchanged when nothing changed.
 */
export function trackLive(live: readonly LiveSession[], input: LiveInput): readonly LiveSession[] {
  if (input.kind === 'terminal_gone') {
    return without(live, (e) => e.terminalId === input.terminalId)
  }

  const { payload, terminalId } = input

  if (input.taskId || payload.agent_id || !terminalId) return live

  switch (payload.hook_event_name) {
    case 'SessionStart': {
      const entry = { workspaceId: input.workspaceId, terminalId, sessionId: payload.session_id }
      const same = live.find((e) => e.terminalId === terminalId)

      if (same && same.sessionId === entry.sessionId && same.workspaceId === entry.workspaceId) {
        return live
      }

      return [...live.filter((e) => e.terminalId !== terminalId), entry]
    }

    case 'SessionEnd':
      return without(live, (e) => e.terminalId === terminalId && e.sessionId === payload.session_id)

    default:
      return live
  }
}

function without(
  live: readonly LiveSession[],
  drop: (e: LiveSession) => boolean
): readonly LiveSession[] {
  return live.some(drop) ? live.filter((e) => !drop(e)) : live
}

export interface RestorePlan {
  resume: LiveSession[]
  skip: Array<{ entry: LiveSession; why: string }>
}

/**
 * Which of a previous daemon's sessions to resume: one per session id, in a
 * workspace that still exists and is not archived, and not already live again.
 */
export function planRestore(
  pending: readonly LiveSession[],
  workspace: (id: string) => Workspace | undefined,
  liveSessionIds: ReadonlySet<string>
): RestorePlan {
  const plan: RestorePlan = { resume: [], skip: [] }
  const taken = new Set(liveSessionIds)

  for (const entry of pending) {
    const ws = workspace(entry.workspaceId)
    let why: string | null = null

    if (!ws) why = 'the workspace is gone'
    else if (ws.archivedAt) why = 'the workspace is archived'
    else if (taken.has(entry.sessionId)) why = 'the session is already live'

    if (why) {
      plan.skip.push({ entry, why })
      continue
    }

    taken.add(entry.sessionId)
    plan.resume.push(entry)
  }

  return plan
}

export interface LiveSessionsOptions {
  /** The record as the previous daemon left it. */
  load: () => LiveSession[]
  /** Persists the whole record (this daemon's live sessions and those still to restore). */
  save: (entries: LiveSession[]) => void
  /** Quiet hours are on and not unlocked: no terminal may be opened. */
  locked: () => boolean
  workspace: (id: string) => Workspace | undefined
  /** The terminal is alive in this daemon and belongs to the workspace. */
  isWorkspaceTerminal: (terminalId: string, workspaceId: string) => boolean
  /** Opens a terminal in the workspace that resumes the session; returns its id. */
  resume: (entry: LiveSession) => string
  log: (msg: string) => void
}

/** The record of live sessions, and their restore at daemon start or at the next unlock. */
export class LiveSessions {
  /** This daemon's live sessions. */
  private live: readonly LiveSession[] = []
  /** The previous daemon's, not yet restored (kept while quiet hours are locked). */
  private pending: LiveSession[] = []
  private running = false

  constructor(private o: LiveSessionsOptions) {}

  /**
   * Takes the previous daemon's record. An entry whose terminal is alive in this
   * daemon came over with it (a handoff) and is still live; the rest are restored,
   * unless quiet hours are locked.
   */
  start(): void {
    this.running = true
    const stored = this.o.load()
    this.live = stored.filter((e) => this.o.isWorkspaceTerminal(e.terminalId, e.workspaceId))
    this.pending = stored.filter((e) => !this.live.includes(e))

    if (this.live.length > 0) {
      this.o.log(`live sessions: ${this.live.length} session(s) came over with their terminals`)
    }

    if (this.pending.length > 0 && this.o.locked()) {
      this.o.log(
        `live sessions: quiet hours are locked; ${this.pending.length} session(s) wait for the unlock`
      )

      return
    }

    this.restore()
  }

  /**
   * Freezes the record before the daemon tears its terminals down: what shutdown
   * ends is exactly what the next daemon restores.
   */
  stop(): void {
    this.running = false
  }

  /** Quiet hours are no longer locked: restores whatever was kept for the unlock. */
  unlocked(): void {
    if (this.running && !this.o.locked()) this.restore()
  }

  /** A hook from `que hook`; one naming a terminal this daemon does not own counts as from none. */
  hook(
    workspaceId: string,
    terminalId: string | undefined,
    taskId: string | undefined,
    payload: HookEvent
  ): void {
    const term =
      terminalId && this.o.isWorkspaceTerminal(terminalId, workspaceId) ? terminalId : undefined

    this.apply({ kind: 'hook', workspaceId, terminalId: term, taskId, payload })
  }

  /** A main Claude session is live in the terminal. */
  isLive(terminalId: string): boolean {
    return this.live.some((e) => e.terminalId === terminalId)
  }

  /** The terminal exited or was killed. */
  terminalGone(terminalId: string): void {
    this.apply({ kind: 'terminal_gone', terminalId })
  }

  private apply(input: LiveInput): void {
    if (!this.running) return
    const next = trackLive(this.live, input)

    if (next === this.live) return
    this.live = next
    this.persist()
  }

  private persist(): void {
    try {
      this.o.save([...this.pending, ...this.live])
    } catch (err) {
      this.o.log(`live sessions: saving the record failed: ${errorMessage(err)}`)
    }
  }

  /** Consumes every pending entry first (none is ever resumed twice), then resumes the plan. */
  private restore(): void {
    if (this.pending.length === 0) return
    const batch = this.pending
    this.pending = []
    this.persist()
    const plan = planRestore(batch, this.o.workspace, new Set(this.live.map((e) => e.sessionId)))

    for (const { entry, why } of plan.skip) {
      this.o.log(
        `live sessions: skipped session ${entry.sessionId} of workspace ${entry.workspaceId}: ${why}`
      )
    }

    for (const entry of plan.resume) {
      try {
        const terminalId = this.o.resume(entry)
        this.o.log(
          `live sessions: resuming session ${entry.sessionId} of workspace ${entry.workspaceId} in terminal ${terminalId}`
        )
      } catch (err) {
        this.o.log(
          `live sessions: could not resume session ${entry.sessionId} of workspace ${entry.workspaceId}: ${errorMessage(err)}`
        )
      }
    }
  }
}

/** The kv key the record is kept under. */
const KV_KEY = 'live_sessions'

/** The record's persistence in the store's kv table. */
export function storedLiveSessions(store: Store): Pick<LiveSessionsOptions, 'load' | 'save'> {
  return {
    load: () => decodeLiveSessions(store.getKv(KV_KEY)),
    save: (entries) => store.setKv(KV_KEY, entries.length > 0 ? JSON.stringify(entries) : null)
  }
}
