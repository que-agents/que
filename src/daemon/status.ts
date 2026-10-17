// Runs the status engine for every workspace: feeds it hook events, terminal
// exits, a clock tick, and `claude agents --json`; persists transitions and
// emits workspace.status.
import fs from 'node:fs'
import type { UserConfig } from '../shared/config'
import { run } from '../shared/exec'
import type { Events, HookEvent } from '../shared/protocol'
import type { Workspace, WorkspaceStatus } from '../shared/types'
import { type AgentEntry, reduce, type StatusInput, type StatusState } from './status-engine'
import { decodeAgents } from './status.decode'
import type { Store } from './store'

export type Emit = <E extends keyof Events>(event: E, data: Events[E]) => void

export interface StatusServiceOptions {
  store: Store
  emit: Emit
  /** Current user config (re-read by the caller as it sees fit). */
  config: () => UserConfig
  log?: (msg: string) => void
  now?: () => number
  /** Stall check interval. Default 5 s. */
  tickMs?: number
}

interface Tracked extends StatusState {
  transcriptPath?: string
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString())

function fromRow(w: Workspace): Tracked {
  return {
    status: w.status,
    reason: w.statusReason,
    statusAt: Date.parse(w.statusAt),
    lastActivityAt: w.lastActivityAt ? Date.parse(w.lastActivityAt) : null,
    sessionId: w.sessionId,
    hookAt: null
  }
}

export class StatusService {
  /** Every unarchived workspace's state, from start(); archiving forgets one. */
  private states = new Map<string, Tracked>()
  private tickTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private polling = false
  private stopped = true
  /** After stop(): the store may be closed; every input is dropped. */
  private closed = false
  private readonly now: () => number

  constructor(private opts: StatusServiceOptions) {
    this.now = opts.now ?? Date.now
  }

  start(): void {
    this.stopped = false

    for (const w of this.opts.store.listWorkspaces()) {
      if (!this.states.has(w.id)) this.states.set(w.id, fromRow(w))
    }

    this.tickTimer = setInterval(() => this.tick(), this.opts.tickMs ?? 5_000)
    this.tickTimer.unref()
    this.schedulePoll()
  }

  stop(): void {
    this.stopped = true
    this.closed = true

    if (this.tickTimer) clearInterval(this.tickTimer)

    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.tickTimer = null
    this.pollTimer = null
  }

  private state(id: string): Tracked | undefined {
    if (this.closed) return undefined
    const known = this.states.get(id)

    if (known) return known
    const row = this.opts.store.getWorkspace(id)

    if (!row || row.archivedAt) return undefined
    const s = fromRow(row)
    this.states.set(id, s)

    return s
  }

  /**
   * Sets a status from outside the engine (workspace setup). With `onlyFrom`,
   * only while the workspace is still in that status, so a session that
   * started reporting during setup is not overwritten.
   */
  set(
    id: string,
    status: WorkspaceStatus,
    reason: string | null = null,
    onlyFrom?: WorkspaceStatus
  ): void {
    const prev = this.state(id)

    if (!prev || (onlyFrom && prev.status !== onlyFrom)) return
    const now = this.now()
    this.commit(id, prev, { ...prev, status, reason, statusAt: now })
  }

  /** Feeds one input to the engine for a workspace. */
  apply(id: string, input: StatusInput): void {
    const prev = this.state(id)

    if (!prev) return
    const stallTimeoutMs = this.opts.config().stallTimeoutMinutes * 60_000
    const next = reduce(prev, input, this.now(), { stallTimeoutMs })
    this.commit(id, prev, { ...next, transcriptPath: prev.transcriptPath })
  }

  /** A hook event from `que hook`: stored, then fed to the engine. */
  hook(id: string, payload: HookEvent): void {
    const prev = this.state(id)

    if (!prev) return
    const event = payload.hook_event_name
    this.opts.store.insertHookEvent(
      id,
      payload.session_id,
      event,
      payload,
      new Date(this.now()).toISOString()
    )

    if (!payload.agent_id) prev.transcriptPath = payload.transcript_path

    this.apply(id, { kind: 'hook', event, payload })
  }

  forget(id: string): void {
    this.states.delete(id)
  }

  private commit(id: string, prev: Tracked, next: Tracked): void {
    this.states.set(id, next)
    const statusChanged = prev.status !== next.status || prev.reason !== next.reason
    const sessionChanged = prev.sessionId !== next.sessionId

    if (!statusChanged && !sessionChanged && prev.lastActivityAt === next.lastActivityAt) return
    this.opts.store.updateStatus(id, {
      status: next.status,
      reason: next.reason,
      at: new Date(next.statusAt).toISOString(),
      lastActivityAt: iso(next.lastActivityAt),
      sessionId: next.sessionId
    })

    if (statusChanged) {
      this.opts.store.insertStatusLog(
        id,
        next.status,
        next.reason,
        new Date(next.statusAt).toISOString()
      )
      this.opts.log?.(
        `workspace ${id} ${prev.status} -> ${next.status}${next.reason ? ` (${next.reason})` : ''}`
      )
      this.opts.emit('workspace.status', {
        id,
        status: next.status,
        reason: next.reason || undefined,
        at: new Date(next.statusAt).toISOString()
      })
    }

    if (sessionChanged) {
      const ws = this.opts.store.getWorkspace(id)

      if (ws) this.opts.emit('workspace.updated', ws)
    }
  }

  /** Stall check; a transcript written since the last hook counts as activity. */
  tick(): void {
    if (this.closed) return
    const working = [...this.states].filter(([, s]) => s.status === 'working')

    for (const [id, s] of working) {
      if (s.transcriptPath) {
        try {
          const mtime = fs.statSync(s.transcriptPath).mtimeMs

          if (s.lastActivityAt === null || mtime > s.lastActivityAt) {
            this.commit(id, s, { ...s, lastActivityAt: Math.floor(mtime) })
          }
        } catch {
          // No transcript (yet); the hook timestamps are all there is.
        }
      }

      this.apply(id, { kind: 'tick' })
    }
  }

  private schedulePoll(): void {
    if (this.stopped) return
    const ms = Math.max(100, this.opts.config().statusPollSeconds * 1000)
    this.pollTimer = setTimeout(() => {
      void this.pollAgents().finally(() => this.schedulePoll())
    }, ms)
    this.pollTimer.unref()
  }

  /** Cross-checks hook-derived state against `claude agents --json` (found on PATH). */
  async pollAgents(): Promise<void> {
    if (this.polling) return
    this.polling = true

    try {
      const entries = await listAgents()

      if (this.stopped) return
      const byPath = new Map(this.opts.store.listWorkspaces().map((w) => [w.path, w.id]))

      for (const entry of entries) {
        const id = entry.cwd ? byPath.get(entry.cwd) : undefined

        if (id) this.apply(id, { kind: 'agents_json', entry })
      }
    } finally {
      this.polling = false
    }
  }
}

/** Runs `claude agents --json`; a missing binary or bad output is no agents. */
async function listAgents(): Promise<AgentEntry[]> {
  const r = await run('claude', ['agents', '--json'], { timeoutMs: 5_000 })

  if (!r.ok) return []

  try {
    return decodeAgents(JSON.parse(r.stdout)) ?? []
  } catch {
    return []
  }
}
