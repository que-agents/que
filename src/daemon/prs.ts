// Keeps each workspace's pull request fresh: polls `gh pr list` for the
// workspace's branch, stores what changed, and emits workspace.updated.
// Also answers workspace.prThread: the conversation is fetched on demand and
// cached until the tracker sees the pull request's updatedAt move.
import fs from 'node:fs'
import { join } from 'node:path'
import type { UserConfig } from '../shared/config'
import { firstLine, run } from '../shared/exec'
import { ErrorCodes, type WorkspaceCreatePrResult } from '../shared/protocol'
import type { QuePaths } from '../shared/paths'
import {
  ACTIVE_STATES,
  type JsonValue,
  type PrThread,
  type PullRequest,
  type Workspace
} from '../shared/types'
import { conflict, ghFailed, notFound, RpcError } from './errors'
import { finishTask, isProtectedBranch } from './finisher'
import { parsePullRequest, samePullRequest } from './pr-state'
import { decodeHeadRef, decodePullRequest, type GhPullRequest } from './pr-state.decode'
import { Poller } from './poller'
import { jsonPages, parsePrThread } from './pr-thread'
import { decodeLineComments, decodePrView } from './pr-thread.decode'
import type { EventBus } from './bus'
import type { Store } from './store'
import type { TaskQueue } from './queue'
import type { WorkspaceManager } from './workspaces'
import { errorMessage } from '../shared/errors.decode'

const FIELDS = 'number,url,title,state,isDraft,reviewDecision,statusCheckRollup,mergedAt,updatedAt'

/** A project's tick lists at most this many of its most recent pull requests. */
const LIST_LIMIT = 100

/** A merged or closed pull request is only re-checked on every Nth tick. */
const SETTLED_EVERY = 5

export interface PrServiceOptions {
  store: Store
  workspaces: Pick<WorkspaceManager, 'get' | 'project'>
  tasks: Pick<TaskQueue, 'list'>
  paths: Pick<QuePaths, 'workspaceLogsDir'>
  /** The daemon's bus: a finished task refreshes its workspace, a removed one is forgotten. */
  bus: EventBus
  config: () => UserConfig
  log?: (msg: string) => void
}

/** Runs `gh <args>` in cwd and parses what it prints (as JSON, unless `parse` says otherwise). */
async function ghJson(
  args: string[],
  cwd: string,
  signal: AbortSignal,
  parse: (stdout: string) => JsonValue = (out) => JSON.parse(out) as JsonValue
): Promise<JsonValue> {
  const r = await run('gh', args, { cwd, timeoutMs: 15_000, signal, maxBuffer: 32 * 1024 * 1024 })

  if (!r.ok) throw new Error(firstLine(r.stderr, r.error))

  try {
    return parse(r.stdout)
  } catch {
    throw new Error('gh printed output that is not JSON')
  }
}

/** The newest pull request for `branch`, or with no branch the repository's newest LIST_LIMIT. */
async function ghPrList(
  branch: string | null,
  cwd: string,
  signal: AbortSignal
): Promise<unknown[]> {
  const args = branch
    ? ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', FIELDS]
    : [
        'pr',
        'list',
        '--state',
        'all',
        '--limit',
        String(LIST_LIMIT),
        '--json',
        `${FIELDS},headRefName`
      ]

  const parsed = await ghJson(args, cwd, signal)

  if (!Array.isArray(parsed)) throw new Error('gh printed output that is not JSON')

  return parsed
}

/**
 * `gh api --paginate` prints one JSON array per page, back to back; this joins
 * them. A single page parses as is.
 */
function ghLineComments(number: number, cwd: string, signal: AbortSignal): Promise<JsonValue> {
  return ghJson(
    ['api', `repos/{owner}/{repo}/pulls/${number}/comments`, '--paginate'],
    cwd,
    signal,
    (out) => jsonPages(out).flatMap((page) => (Array.isArray(page) ? page : [page])) as JsonValue
  )
}

interface CachedThread {
  thread: PrThread
  number: number
  forUpdatedAt: string | null
}

export class PrService {
  private polling = false
  private tickCount = 0
  /** Workspaces whose last check failed (and were logged), until one succeeds. */
  private failing = new Set<string>()
  /** Each workspace's last fetched conversation, valid while its pull request's updatedAt holds. */
  private threads = new Map<string, CachedThread>()
  private threadFetches = new Map<string, Promise<PrThread>>()

  private readonly poller = new Poller({
    intervalMs: () => Math.max(100, this.opts.config().prPollSeconds * 1000),
    tick: () => this.tick()
  })

  private refreshedDone = new Set<string>()

  constructor(private opts: PrServiceOptions) {
    // Rows carry state as a level, so the set turns "done" into an edge: refresh once per task.
    opts.bus.on('task.updated', ({ id, state, workspaceId }) => {
      if (state !== 'done' || this.refreshedDone.has(id)) return
      this.refreshedDone.add(id)

      if (workspaceId) void this.refresh(workspaceId)
    })
    opts.bus.on('task.removed', ({ id }) => this.refreshedDone.delete(id))
    opts.bus.on('workspace.removed', ({ id }) => this.forget(id))
  }

  start(): void {
    this.poller.start()
  }

  stop(): void {
    this.poller.stop()
  }

  private get stopped(): boolean {
    return this.poller.stopped
  }

  /** One pass over every unarchived workspace: one `gh pr list` per project, one at a time. */
  async tick(): Promise<void> {
    if (this.polling) return
    this.polling = true

    try {
      const n = this.tickCount++
      const byProject = new Map<string, Workspace[]>()

      for (const ws of this.opts.store.listWorkspaces()) {
        const settled = ws.pr?.state === 'merged' || ws.pr?.state === 'closed'

        if (settled && n % SETTLED_EVERY !== 0) continue
        const list = byProject.get(ws.projectId)

        if (list) list.push(ws)
        else byProject.set(ws.projectId, [ws])
      }

      for (const list of byProject.values()) {
        if (this.stopped) return
        await this.poller.track(this.checkProject(list))
      }
    } finally {
      this.polling = false
    }
  }

  /** Checks one workspace now. */
  async refresh(id: string): Promise<void> {
    if (this.stopped) return
    const ws = this.opts.store.getWorkspace(id)

    if (ws && !ws.archivedAt) await this.check(ws)
  }

  /**
   * The workspace's pull request conversation: cached until the tracker sees
   * the pull request change, or fetched now with `refresh`. Null without a pull request.
   */
  async thread(id: string, refresh = false): Promise<PrThread | null> {
    const ws = this.opts.store.getWorkspace(id)

    if (!ws || ws.archivedAt) throw notFound(`no workspace ${id}`)
    const pr = ws.pr

    if (!pr) {
      this.threads.delete(id)

      return null
    }

    const cached = this.threads.get(id)

    if (
      !refresh &&
      cached &&
      cached.number === pr.number &&
      cached.forUpdatedAt === (pr.updatedAt ?? null)
    ) {
      return cached.thread
    }

    const running = this.threadFetches.get(id)

    if (running) return running
    const fetch = this.fetchThread(ws, pr).finally(() => this.threadFetches.delete(id))
    this.threadFetches.set(id, fetch)

    return fetch
  }

  /** Drops what is cached for a workspace (it was removed). */
  forget(id: string): void {
    this.threads.delete(id)
  }

  private async fetchThread(ws: Workspace, pr: PullRequest): Promise<PrThread> {
    let view: unknown
    let lines: unknown

    try {
      ;[view, lines] = await Promise.all([
        ghJson(
          ['pr', 'view', String(pr.number), '--json', 'comments,reviews'],
          ws.path,
          this.poller.signal
        ),
        ghLineComments(pr.number, ws.path, this.poller.signal)
      ])
    } catch (err) {
      throw ghFailed(errorMessage(err))
    }

    const thread = parsePrThread(
      decodePrView(view),
      decodeLineComments(lines),
      ws.id,
      pr.number,
      new Date().toISOString()
    )

    this.threads.set(ws.id, { thread, number: pr.number, forUpdatedAt: pr.updatedAt ?? null })

    return thread
  }

  /** Resolves once every check that was running when stop() was called has ended. */
  drain(): Promise<void> {
    return this.poller.drain()
  }

  private check(ws: Workspace): Promise<void> {
    return this.poller.track(this.checkOne(ws))
  }

  /** The workspaces whose branch que may ask about (never a protected one). */
  private checkable(list: Workspace[]): Workspace[] {
    const project = this.opts.workspaces.project(list[0].projectId)
    const { protectedBranches } = this.opts.config()

    return list.filter(
      (ws) => !isProtectedBranch(ws.branch, project.defaultBranch, protectedBranches)
    )
  }

  /**
   * Checks one project's workspaces with one listing, matched by branch. A
   * branch missing from a full page (LIST_LIMIT) may hold an older pull
   * request, so it is asked about on its own.
   */
  private async checkProject(list: Workspace[]): Promise<void> {
    const open = this.checkable(list)

    if (open.length === 0) return
    let items: unknown[]

    try {
      items = await ghPrList(null, open[0].path, this.poller.signal)
    } catch (err) {
      for (const ws of open) this.failed(ws, errorMessage(err))

      return
    }

    if (this.stopped) return
    const byBranch = new Map<string, GhPullRequest | null>()

    for (const item of items) {
      const head = decodeHeadRef(item)

      if (head !== null && !byBranch.has(head)) byBranch.set(head, decodePullRequest(item))
    }

    for (const ws of open) {
      if (this.stopped) return

      if (byBranch.has(ws.branch) || items.length < LIST_LIMIT)
        this.settle(ws, byBranch.get(ws.branch) ?? null)
      else await this.checkOne(ws)
    }
  }

  private async checkOne(ws: Workspace): Promise<void> {
    if (this.checkable([ws]).length === 0) return
    let items: unknown[]

    try {
      items = await ghPrList(ws.branch, ws.path, this.poller.signal)
    } catch (err) {
      this.failed(ws, errorMessage(err))

      return
    }

    if (!this.stopped) this.settle(ws, decodePullRequest(items[0]))
  }

  /** Logs a workspace's first failed check (until one succeeds). */
  private failed(ws: Workspace, message: string): void {
    if (this.stopped || this.failing.has(ws.id)) return
    this.failing.add(ws.id)
    this.opts.log?.(`pr check failed for ${ws.id}: ${message}`)
  }

  /** Stores and announces the pull request `gh` reported for a workspace (null: none). */
  private settle(ws: Workspace, raw: GhPullRequest | null): void {
    if (this.failing.delete(ws.id)) this.opts.log?.(`pr check recovered for ${ws.id}`)
    const next = raw && parsePullRequest(raw, new Date().toISOString())
    const current = this.opts.store.getWorkspace(ws.id)

    if (!current || current.archivedAt) return

    if (!next) this.threads.delete(ws.id)

    if (samePullRequest(current.pr, next)) return
    this.opts.store.setWorkspacePr(ws.id, next)
    this.opts.bus.emit('workspace.updated', { ...current, pr: next })
  }

  /**
   * Opens a draft pull request from an interactive workspace with the
   * finisher: commits what is uncommitted as `title`, pushes, and runs gh.
   */
  async create(id: string, rawTitle: string): Promise<WorkspaceCreatePrResult> {
    const { workspaces, tasks, store, paths } = this.opts
    const ws = workspaces.get(id)
    const title = rawTitle.trim()

    if (!title) throw new RpcError(ErrorCodes.BadRequest, 'title is required')
    const busy = tasks.list().some((t) => t.workspaceId === id && ACTIVE_STATES.has(t.state))

    if (busy) throw conflict(`a task is running in workspace ${ws.name}`)
    const lines: string[] = []
    fs.mkdirSync(paths.workspaceLogsDir, { recursive: true, mode: 0o700 })

    const result = await finishTask({
      task: { title, resultText: null },
      workspace: ws,
      project: workspaces.project(ws.projectId),
      protectedBranches: this.opts.config().protectedBranches,
      bodyFile: join(paths.workspaceLogsDir, `${ws.id}.pr.md`),
      log: (line) => {
        lines.push(line)
        this.opts.log?.(`workspace ${ws.id} ${line}`)
      }
    })

    if (!result.ok) {
      const detail = lines.at(-1) ?? `${result.step} failed`

      if (result.step === 'protected_branch') throw conflict(detail)
      throw new RpcError(ErrorCodes.Internal, detail)
    }

    if (!result.prUrl) {
      throw conflict(`${ws.branch} has no commits ahead of its base; nothing to open a PR for`)
    }

    store.setWorkspacePrUrl(ws.id, result.prUrl)
    this.opts.bus.emit('workspace.updated', workspaces.get(ws.id))
    void this.refresh(ws.id)

    return { prUrl: result.prUrl }
  }
}
