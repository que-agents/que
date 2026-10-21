// Keeps each workspace's pull requests fresh: polls `gh pr list` for the
// workspace's branch, looks up the pull request workspace.createPr opened when it
// is not on the branch (`gh pr view <n>`), stores what changed, and emits
// workspace.updated.
// Also answers workspace.prThread: the conversation is fetched on demand and
// cached until the tracker sees the pull request's updatedAt move.
import type { UserConfig } from '../shared/config'
import { firstLine, run } from '../shared/exec'
import { ErrorCodes, type WorkspaceCreatePrResult } from '../shared/protocol'
import type { JsonValue, PrThread, PullRequest, Workspace } from '../shared/types'
import { conflict, ghFailed, notFound, RpcError } from './errors'
import { isProtectedBranch, openDraftPr } from './draft-pr'
import {
  currentPullRequest,
  isSettled,
  parsePullRequest,
  PR_LIST_CAP,
  pullRequestList,
  samePullRequests
} from './pr-state'
import {
  decodeHeadRef,
  decodePullRequest,
  decodePullRequests,
  FIELDS,
  type GhPullRequest
} from './pr-state.decode'
import { Poller } from './poller'
import { jsonPages, parsePrThread } from './pr-thread'
import { decodeLineComments, decodePrView } from './pr-thread.decode'
import type { EventBus } from './bus'
import type { Store } from './store'
import type { WorkspaceManager } from './workspaces'
import { errorMessage } from '../shared/errors.decode'
import { prUrlNumber } from '../shared/pr-url'

/** A project's tick lists at most this many of its most recent pull requests. */
const LIST_LIMIT = 100

/** A merged or closed pull request is only re-checked on every Nth tick. */
const SETTLED_EVERY = 5

export interface PrServiceOptions {
  store: Store
  workspaces: Pick<WorkspaceManager, 'get' | 'project' | 'syncBranch'>
  /** The daemon's bus: a removed workspace is forgotten. */
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

/** The newest PR_LIST_CAP pull requests for `branch`, or with no branch the repository's newest LIST_LIMIT. */
async function ghPrList(
  branch: string | null,
  cwd: string,
  signal: AbortSignal
): Promise<unknown[]> {
  const args = [
    'pr',
    'list',
    ...(branch ? ['--head', branch] : []),
    '--state',
    'all',
    '--limit',
    String(branch ? PR_LIST_CAP : LIST_LIMIT),
    '--json',
    branch ? FIELDS : `${FIELDS},headRefName`
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

  constructor(private opts: PrServiceOptions) {
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

  /** One pass over the workspaces: each branch re-read, then one `gh pr list` per project. */
  async tick(): Promise<void> {
    if (this.polling) return
    this.polling = true

    try {
      const n = this.tickCount++
      const due = n % SETTLED_EVERY === 0
      const listed = this.opts.store.listWorkspaces()
      const checked = listed.filter((ws) => due || ws.pr === null || !isSettled(ws.pr))
      const byProject = new Map<string, Workspace[]>()

      for (const ws of await Promise.all(checked.map((ws) => this.sync(ws)))) {
        const list = byProject.get(ws.projectId)

        if (list) list.push(ws)
        else byProject.set(ws.projectId, [ws])
      }

      for (const list of byProject.values()) {
        if (this.stopped) return
        await this.poller.track(this.checkProject(list, due))
      }
    } finally {
      this.polling = false
    }
  }

  /** Checks one workspace now. */
  async refresh(id: string): Promise<void> {
    if (this.stopped) return
    const ws = this.opts.store.getWorkspace(id)

    if (ws && !ws.archivedAt) await this.check(await this.sync(ws))
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

  /** The workspace with the branch its worktree has checked out; as stored when that cannot be read. */
  private sync(ws: Workspace): Promise<Workspace> {
    return this.poller.track(this.opts.workspaces.syncBranch(ws.id).catch(() => ws))
  }

  private check(ws: Workspace): Promise<void> {
    return this.poller.track(this.checkOne(ws, true))
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
   * Checks one project's workspaces with one listing, grouped by branch. A
   * branch missing from a full page (LIST_LIMIT) may hold an older pull
   * request, so it is asked about on its own. `due`: a settled pull request
   * is re-checked on this tick.
   */
  private async checkProject(list: Workspace[], due: boolean): Promise<void> {
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
    const byBranch = new Map<string, GhPullRequest[]>()

    for (const item of items) {
      const head = decodeHeadRef(item)
      const pr = decodePullRequest(item)

      if (head === null || !pr) continue
      const prs = byBranch.get(head)

      if (prs) prs.push(pr)
      else byBranch.set(head, [pr])
    }

    for (const ws of open) {
      if (this.stopped) return

      if (byBranch.has(ws.branch) || items.length < LIST_LIMIT)
        await this.settle(ws, byBranch.get(ws.branch) ?? [], due)
      else await this.checkOne(ws, due)
    }
  }

  private async checkOne(ws: Workspace, due: boolean): Promise<void> {
    if (this.checkable([ws]).length === 0) return
    let items: unknown[]

    try {
      items = await ghPrList(ws.branch, ws.path, this.poller.signal)
    } catch (err) {
      this.failed(ws, errorMessage(err))

      return
    }

    if (!this.stopped) await this.settle(ws, decodePullRequests(items), due)
  }

  /** Logs a workspace's first failed check (until one succeeds). */
  private failed(ws: Workspace, message: string): void {
    if (this.stopped || this.failing.has(ws.id)) return
    this.failing.add(ws.id)
    this.opts.log?.(`pr check failed for ${ws.id}: ${message}`)
  }

  /**
   * The pull request workspace.createPr recorded, when it is not among
   * `onBranch`, each looked up by number. A settled one
   * already stored is reused until `due`; one that cannot be looked up keeps
   * its stored copy, and the first failure is reported in `error`.
   */
  private async linked(
    ws: Workspace,
    onBranch: PullRequest[],
    due: boolean,
    checkedAt: string
  ): Promise<{ prs: PullRequest[]; error: string | null }> {
    const known = new Set(onBranch.map((pr) => pr.number))
    const numbers = new Set<number>()
    const urls = ws.prUrl ? [ws.prUrl] : []

    for (const url of urls) {
      const n = prUrlNumber(url)

      if (n !== null && !known.has(n)) numbers.add(n)
    }

    const stored = new Map(ws.prs.map((pr) => [pr.number, pr]))
    const prs: PullRequest[] = []
    let error: string | null = null

    for (const n of numbers) {
      if (this.stopped) break
      const old = stored.get(n)

      if (old && isSettled(old) && !due) {
        prs.push(old)
        continue
      }

      try {
        const raw = decodePullRequest(
          await ghJson(['pr', 'view', String(n), '--json', FIELDS], ws.path, this.poller.signal)
        )

        if (raw) prs.push(parsePullRequest(raw, checkedAt))
        else if (old) prs.push(old)
      } catch (err) {
        error ??= errorMessage(err)

        if (old) prs.push(old)
      }
    }

    return { prs, error }
  }

  /**
   * Stores and announces the pull requests `gh` reported for a workspace's
   * branch, joined with the one workspace.createPr opened elsewhere, and the current
   * one among them.
   */
  private async settle(ws: Workspace, raw: GhPullRequest[], due: boolean): Promise<void> {
    const checkedAt = new Date().toISOString()
    const onBranch = raw.map((r) => parsePullRequest(r, checkedAt))
    const extra = await this.linked(ws, onBranch, due, checkedAt)

    if (this.stopped) return

    if (extra.error !== null) this.failed(ws, extra.error)
    else if (this.failing.delete(ws.id)) this.opts.log?.(`pr check recovered for ${ws.id}`)
    const prs = pullRequestList([...onBranch, ...extra.prs])
    const next = currentPullRequest(prs)
    const current = this.opts.store.getWorkspace(ws.id)

    if (!current || current.archivedAt) return

    if (!next) this.threads.delete(ws.id)

    if (samePullRequests(current.prs, prs)) return
    this.opts.store.setWorkspacePrs(ws.id, prs)
    this.opts.bus.emit('workspace.updated', { ...current, pr: next, prs })
  }

  /**
   * Opens a draft pull request from a workspace: commits what is uncommitted
   * as `title`, pushes, and runs gh.
   */
  async create(id: string, rawTitle: string): Promise<WorkspaceCreatePrResult> {
    const { workspaces, store } = this.opts
    const ws = await workspaces.syncBranch(id)
    const title = rawTitle.trim()

    if (!title) throw new RpcError(ErrorCodes.BadRequest, 'title is required')
    const lines: string[] = []

    const result = await openDraftPr({
      title,
      workspace: ws,
      project: workspaces.project(ws.projectId),
      protectedBranches: this.opts.config().protectedBranches,
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
