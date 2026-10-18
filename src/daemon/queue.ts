// The task queue: task.* / queue.* / report.get, the
// dispatcher that starts queued tasks up to the concurrency cap while the
// queue is open, the clock tick (stalls, pause expiry, sleep/wake), the
// keep-awake, and recovery after a daemon restart. Every state change goes
// through the pure task machine; this module persists it and reacts.
import { type ChildProcess, spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { titleOf } from '../shared/brief'
import type { UserConfig } from '../shared/config'
import type { QuePaths } from '../shared/paths'
import type {
  QueueState,
  Report,
  TaskAddParams,
  TaskListParams,
  WorkspaceDigest
} from '../shared/protocol'
import type { Project, Task, TaskState } from '../shared/types'
import { buildWorkspaceDigest, sortDigests } from './digest'
import { badRequest, conflict, notFound } from './errors'
import { buildReport, reportSince } from './report'
import { reapOrphan, TaskRunner } from './runner'
import type { Emit, StatusService } from './status'
import { newId, type Store } from './store'
import {
  ACTIVE_STATES,
  LIVE_STATES,
  nextTask,
  type TaskEvent,
  type TaskHookPayload
} from './task-machine'
import { commitsAhead, type WorkspaceManager } from './workspaces'
import { findOnPath } from './wrapper'

const KV_OPEN = 'queue.open'
const KV_OPENED_AT = 'queue.opened_at'
const KV_CONCURRENCY = 'concurrency'

/** How long a run's activity stamp and latest text may wait in memory before they are written. */
const FLUSH_MS = 3_000

/** Fields a stream message changes on its own; writing them can wait for the flush. */
const DEFERRED: ReadonlySet<keyof Task> = new Set(['lastActivityAt', 'resultText', 'updatedAt'])

/** A wall-clock jump this much larger than the monotonic clock's means the machine slept. */
export const WAKE_THRESHOLD_MS = 2 * 60_000

/** True when the wall clock advanced more than the monotonic clock by over the threshold. */
export function detectWake(
  prevWall: number,
  prevMono: number,
  wall: number,
  mono: number,
  thresholdMs = WAKE_THRESHOLD_MS
): boolean {
  return wall - prevWall - (mono - prevMono) > thresholdMs
}

/** The tasks in any of `states`, from a by-state count. */
function sumOf(counts: Record<TaskState, number>, states: Iterable<TaskState>): number {
  let n = 0

  for (const s of states) n += counts[s]

  return n
}

export interface TaskQueueOptions {
  store: Store
  paths: QuePaths
  workspaces: WorkspaceManager
  status: StatusService
  emit: Emit
  config: () => UserConfig
  killTerminals: (workspaceId: string) => number
  socket: () => string
  log: (msg: string) => void
  /** Stall / pause / wake tick. Default 5 s. */
  tickMs?: number
}

export class TaskQueue {
  readonly runner: TaskRunner
  private timer: NodeJS.Timeout | null = null
  private kickScheduled = false
  private closed = false
  private caffeinate: ChildProcess | null = null
  private warnedNoCaffeinate = false
  private lastWall = 0
  private lastMono = 0
  /** Every live task this queue has touched, as it last committed it; the store may lag. */
  private live = new Map<string, Task>()
  /** Live tasks whose deferred fields are not written yet. */
  private dirty = new Set<string>()
  private flushTimer: NodeJS.Timeout | null = null

  constructor(private o: TaskQueueOptions) {
    this.runner = new TaskRunner({
      store: o.store,
      paths: o.paths,
      workspaces: o.workspaces,
      status: o.status,
      config: o.config,
      apply: (id, event) => this.apply(id, event),
      patch: (id, fields) => this.patch(id, fields),
      killTerminals: o.killTerminals,
      socket: o.socket,
      log: o.log
    })
  }

  // ---- lifecycle --------------------------------------------------------------

  /** Recovers tasks a previous daemon left live, then starts the clock tick. */
  start(): void {
    for (const t of this.o.store.listTasks([...ACTIVE_STATES])) {
      if (t.pid !== null) reapOrphan(t.pid, this.o.log)
      this.o.log(`task ${t.id}: daemon restarted while ${t.state}`)
      this.patch(t.id, { pid: null })
      this.apply(t.id, { type: 'restart' })
    }

    this.lastWall = Date.now()
    this.lastMono = performance.now()
    this.timer = setInterval(() => this.tick(), this.o.tickMs ?? 5_000)
    this.timer.unref()
    this.kick()
  }

  /** Daemon shutdown: stops the clock tick, every run, and the keep-awake. */
  async shutdown(): Promise<void> {
    this.flush()
    this.closed = true

    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.runner.close()
    this.stopCaffeinate()
  }

  /** Pids of task runs and the keep-awake (for leak checks). */
  pids(): number[] {
    const pids = this.runner.pids()

    if (this.caffeinate?.pid !== undefined && this.caffeinate.exitCode === null) {
      pids.push(this.caffeinate.pid)
    }

    return pids
  }

  // ---- the machine ------------------------------------------------------------

  private limits() {
    return { stallTimeoutMs: this.o.config().stallTimeoutMinutes * 60_000 }
  }

  /** The task as last committed: the in-memory copy of a live one, else the stored row. */
  private read(id: string): Task | undefined {
    return this.live.get(id) ?? this.o.store.getTask(id)
  }

  /** Stored tasks with each live one replaced by its in-memory copy. */
  private current(tasks: Task[]): Task[] {
    return tasks.map((t) => this.live.get(t.id) ?? t)
  }

  /** Writes the deferred fields of every dirty task. */
  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null

    if (this.closed) return

    for (const id of this.dirty) {
      const t = this.live.get(id)

      if (t) this.o.store.updateTask(t)
    }

    this.dirty.clear()
  }

  /** Feeds one event to the machine, persists the result, and reacts. */
  apply(id: string, event: TaskEvent): Task | undefined {
    if (this.closed) return undefined
    const prev = this.read(id)

    if (!prev) return undefined
    const next = nextTask(prev, event, Date.now(), this.limits())
    this.commit(prev, next)

    return next
  }

  private patch(id: string, fields: Partial<Task>): void {
    if (this.closed) return
    const prev = this.read(id)

    if (prev) this.commit(prev, { ...prev, ...fields })
  }

  /**
   * Persists a change. One that only moves a run's activity stamp or latest
   * text (most stream messages) stays in memory until the flush timer or the
   * next other change writes it; a crash can lose those few seconds.
   */
  private commit(prev: Task, next: Task): void {
    const changed = (Object.keys(next) as Array<keyof Task>).filter(
      (k) => k !== 'updatedAt' && next[k] !== prev[k]
    )

    if (changed.length === 0) return
    next.updatedAt = new Date().toISOString()

    if (LIVE_STATES.has(next.state)) this.live.set(next.id, next)
    else this.live.delete(next.id)

    if (LIVE_STATES.has(next.state) && changed.every((k) => DEFERRED.has(k))) {
      this.dirty.add(next.id)
      this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS)
      this.flushTimer.unref()

      return
    }

    this.dirty.delete(next.id)
    this.o.store.updateTask(next)
    const statusChanged = prev.state !== next.state || prev.reason !== next.reason

    if (statusChanged) {
      this.o.log(
        `task ${next.id} ${prev.state} -> ${next.state}${next.reason ? ` (${next.reason})` : ''}`
      )
      this.o.emit('task.status', {
        id: next.id,
        state: next.state,
        reason: next.reason || undefined,
        at: next.updatedAt
      })
      this.runner.onTransition(prev, next)
      this.emitState()
      this.keepAwake()
      this.kick()
    }

    const updated: Array<keyof Task> = [
      'costUsd',
      'turns',
      'prUrl',
      'sessionId',
      'branch',
      'workspaceId',
      'pid'
    ]

    if (updated.some((k) => prev[k] !== next[k])) this.o.emit('task.updated', next)
  }

  // ---- dispatcher -------------------------------------------------------------

  private concurrency(): number {
    const override = Number(this.o.store.getKv(KV_CONCURRENCY))

    return Number.isInteger(override) && override > 0 ? override : this.o.config().concurrency
  }

  private isOpen(): boolean {
    return this.o.store.getKv(KV_OPEN) === 'true'
  }

  /**
   * Dispatches soon (coalesced). There is no dispatch timer: adding a task,
   * opening the queue, a config change and every task transition (a pause
   * expiring in tick() among them) kick.
   */
  kick(): void {
    if (this.kickScheduled || this.closed) return
    this.kickScheduled = true
    setImmediate(() => {
      this.kickScheduled = false
      this.dispatch()
    })
  }

  /** Starts the oldest queued tasks until the cap; one live task per workspace. */
  dispatch(): void {
    if (this.closed || !this.isOpen()) return
    const active = this.o.store.listTasks([...ACTIVE_STATES])
    const busy = new Set(active.map((t) => t.workspaceId).filter((w): w is string => w !== null))
    let slots = this.concurrency() - active.length

    for (const t of this.o.store.listTasks(['queued'])) {
      if (slots <= 0) break

      if (t.workspaceId && busy.has(t.workspaceId)) continue

      if (t.workspaceId) busy.add(t.workspaceId)
      slots -= 1
      this.runner.start(t.id)
    }
  }

  // ---- clock ------------------------------------------------------------------

  tick(): void {
    if (this.closed) return
    const wall = Date.now()
    const mono = performance.now()
    const woke = detectWake(this.lastWall, this.lastMono, wall, mono)
    this.lastWall = wall
    this.lastMono = mono

    if (woke) this.o.log('wake: the machine slept; re-checking running tasks')

    for (const t of this.o.store.listTasks(['running', 'paused'])) {
      if (woke && t.state === 'running' && !this.runner.isRunning(t.id)) {
        this.apply(t.id, { type: 'exit', code: null, signal: null })
        continue
      }

      this.apply(t.id, { type: 'tick' })
    }

    this.keepAwake()
  }

  /** Holds a `caffeinate -i -w <daemon pid>` while any task is active. */
  private keepAwake(): void {
    if (this.closed) return
    const needed = sumOf(this.o.store.countTasksByState(), ACTIVE_STATES) > 0

    if (needed && !this.caffeinate) {
      const bin = findOnPath('caffeinate', process.env.PATH)

      if (!bin) {
        if (!this.warnedNoCaffeinate) this.o.log('caffeinate not found; the machine may sleep')
        this.warnedNoCaffeinate = true

        return
      }

      const child = spawn(bin, ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
      child.once('error', () => {})
      child.once('exit', () => {
        if (this.caffeinate === child) this.caffeinate = null
      })
      this.caffeinate = child
      this.o.log(`keep-awake on (caffeinate pid ${child.pid})`)
    } else if (!needed && this.caffeinate) {
      this.stopCaffeinate()
      this.o.log('keep-awake off')
    }
  }

  private stopCaffeinate(): void {
    const c = this.caffeinate
    this.caffeinate = null

    if (c && c.exitCode === null) c.kill('SIGTERM')
  }

  // ---- methods ----------------------------------------------------------------

  add(p: TaskAddParams): Task {
    if (p.brief.trim() === '') throw badRequest('brief is required')

    if (!p.projectId === !p.workspaceId) {
      throw badRequest('pass exactly one of projectId or workspaceId')
    }

    let projectId: string

    if (p.workspaceId) {
      const ws = this.o.workspaces.get(p.workspaceId)
      projectId = ws.projectId
    } else {
      projectId = this.o.workspaces.project(p.projectId as string).id
    }

    const source = p.source ?? 'prompt'

    if (!['prompt', 'file'].includes(source)) throw badRequest(`invalid source ${source}`)

    const positive = (v: number | undefined, key: string, int: boolean): void => {
      if (v === undefined) return

      if (!(v > 0) || (int && !Number.isInteger(v))) {
        throw badRequest(`${key} must be a positive ${int ? 'integer' : 'number'}`)
      }
    }

    positive(p.maxTurns, 'maxTurns', true)
    positive(p.maxBudgetUsd, 'maxBudgetUsd', false)
    const title = (p.title?.trim() || titleOf(p.brief)).slice(0, 200)
    const config = this.o.config()
    const now = new Date().toISOString()

    const task: Task = {
      id: newId('tsk_'),
      projectId,
      workspaceId: p.workspaceId ?? null,
      title,
      brief: p.brief,
      source,
      resumeSessionId: p.resumeSessionId ?? null,
      state: 'queued',
      reason: null,
      sessionId: null,
      pid: null,
      attempts: 0,
      costUsd: 0,
      turns: 0,
      maxTurns: p.maxTurns ?? config.maxTurns,
      maxBudgetUsd: p.maxBudgetUsd ?? config.maxBudgetUsd,
      permissionMode: null,
      branch: null,
      prUrl: null,
      resultText: null,
      lastActivityAt: null,
      startedAt: null,
      finishedAt: null,
      pausedUntil: null,
      createdAt: now,
      updatedAt: now
    }

    this.o.store.insertTask(task)
    this.o.log(`task ${task.id} added: ${title}`)
    this.o.emit('task.created', task)
    this.emitState()
    this.kick()

    return task
  }

  list(p: TaskListParams = {}): Task[] {
    return this.current(this.o.store.listTasks(p.state ? [p.state] : undefined))
  }

  get(id: string): Task {
    const t = this.read(id)

    if (!t) throw notFound(`no task ${id}`)

    return t
  }

  stop(id: string): Task {
    const t = this.get(id)

    if (!LIVE_STATES.has(t.state)) throw conflict(`task ${id} is already ${t.state}`)

    return this.apply(id, { type: 'stop' }) ?? t
  }

  remove(id: string): void {
    const t = this.get(id)

    if (LIVE_STATES.has(t.state)) throw conflict(`task ${id} is ${t.state}; stop it first`)
    this.o.store.deleteTask(id)
    this.emitState()
  }

  /** Stops every live task of a workspace (it is being removed). */
  stopWorkspace(workspaceId: string): void {
    for (const t of this.o.store.listTasks([...LIVE_STATES])) {
      if (t.workspaceId === workspaceId) this.apply(t.id, { type: 'stop' })
    }
  }

  hook(taskId: string, payload: TaskHookPayload): void {
    this.apply(taskId, { type: 'hook', payload })
  }

  open(concurrency?: number): QueueState {
    if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
      throw badRequest('concurrency must be a positive integer')
    }

    this.o.store.setKv(KV_OPEN, 'true')
    this.o.store.setKv(KV_OPENED_AT, new Date().toISOString())

    if (concurrency !== undefined) this.o.store.setKv(KV_CONCURRENCY, String(concurrency))
    this.o.log(`queue opened (concurrency ${this.concurrency()})`)
    this.emitState()
    this.kick()

    return this.state()
  }

  close(): QueueState {
    this.o.store.setKv(KV_OPEN, 'false')
    this.o.store.setKv(KV_CONCURRENCY, null)
    this.o.log('queue closed')
    this.emitState()

    return this.state()
  }

  state(): QueueState {
    const counts = this.o.store.countTasksByState()

    return {
      open: this.isOpen(),
      concurrency: this.concurrency(),
      running: sumOf(counts, ACTIVE_STATES),
      queued: counts.queued,
      paused: counts.paused,
      openedAt: this.o.store.getKv(KV_OPENED_AT) ?? null
    }
  }

  private emitState(): void {
    if (!this.closed) this.o.emit('queue.state', this.state())
  }

  async report(since?: string): Promise<Report> {
    if (since !== undefined && Number.isNaN(Date.parse(since))) {
      throw badRequest('since must be an ISO time')
    }

    const now = Date.now()
    const from = reportSince(since, this.o.store.getKv(KV_OPENED_AT) ?? null, now)
    const tasks = this.current(this.o.store.listTasks())
    const open = this.o.store.listWorkspaces()
    const names = new Map(open.map((ws) => [ws.id, ws.name]))

    // An archived workspace is not in the listing; its tasks still show its name.
    for (const t of tasks) {
      if (!t.workspaceId || names.has(t.workspaceId)) continue
      const ws = this.o.store.getWorkspace(t.workspaceId)

      if (ws) names.set(ws.id, ws.name)
    }

    const pending: Array<Promise<WorkspaceDigest>> = []

    for (const ws of open) {
      let project: Project

      try {
        project = this.o.workspaces.project(ws.projectId)
      } catch {
        continue
      }

      const log = this.o.store.listStatusLog(ws.id, from)
      const digest = buildWorkspaceDigest(ws, project, log, Date.parse(from), now)

      if (digest) {
        pending.push(commitsAhead(ws, project).then((n) => ({ ...digest, commitsAhead: n })))
      }
    }

    const digests = await Promise.all(pending)

    return buildReport(tasks, names, from, now, sortDigests(digests))
  }
}
