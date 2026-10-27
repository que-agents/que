// Keeps each workspace's pull requests fresh: the session's pull requests are
// those whose head is any branch the worktree has had checked out (`gh pr list`),
// plus each one the session created (workspace.createPr, or its own `gh pr
// create` seen in a hook), looked up by number (`gh pr view <n>`) when it is not
// on those branches. One already stored is kept when its branch moves on. Stores
// what changed and emits workspace.updated.
// Also answers workspace.prThread: each pull request's conversation is fetched
// on demand and cached until the tracker sees its updatedAt move.
import type { UserConfig } from '../shared/config'
import { firstLine, run } from '../shared/exec'
import { ErrorCodes, type HookEvent, type WorkspaceCreatePrResult } from '../shared/protocol'
import type { JsonValue, PrThread, PullRequest, Workspace } from '../shared/types'
import { conflict, ghFailed, notFound, RpcError } from './errors'
import { withBranch } from './branch-history'
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
  decodePullRequest,
  decodePullRequests,
  FIELDS,
  type GhPullRequest
} from './pr-state.decode'
import { Poller } from './poller'
import { createdPullRequests, prCreateCall } from './pr-created'
import { jsonPages, parsePrThread } from './pr-thread'
import { decodeLineComments, decodePrView } from './pr-thread.decode'
import type { EventBus } from './bus'
import type { Store } from './store'
import { git, type WorkspaceManager } from './workspaces'
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
    FIELDS
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
  forUpdatedAt: string | null
}

/** The thread cache's key: one entry per workspace and pull request. */
const threadKey = (id: string, number: number): string => `${id}:${number}`

export class PrService {
  private polling = false
  private tickCount = 0
  /** Workspaces whose last check failed (and were logged), until one succeeds. */
  private failing = new Set<string>()
  /** Each pull request's last fetched conversation (by threadKey), valid while its updatedAt holds. */
  private threads = new Map<string, CachedThread>()
  private threadFetches = new Map<string, Promise<PrThread>>()
  /** Created pull requests are recorded one hook at a time, so they keep the order they were made in. */
  private recording: Promise<void> = Promise.resolve()

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
   * A pull request's conversation: the workspace's pull request `number`, or without one its
   * current pull request. Cached until the tracker sees that pull request change, or fetched
   * now with `refresh`. Null when the workspace has no such pull request.
   */
  async thread(id: string, refresh = false, number?: number): Promise<PrThread | null> {
    const ws = this.opts.store.getWorkspace(id)

    if (!ws || ws.archivedAt) throw notFound(`no workspace ${id}`)
    const pr = number === undefined ? ws.pr : (ws.prs.find((p) => p.number === number) ?? null)

    if (!pr) return null
    const key = threadKey(id, pr.number)
    const cached = this.threads.get(key)

    if (!refresh && cached && cached.forUpdatedAt === (pr.updatedAt ?? null)) return cached.thread

    const running = this.threadFetches.get(key)

    if (running) return running
    const fetch = this.fetchThread(ws, pr).finally(() => this.threadFetches.delete(key))
    this.threadFetches.set(key, fetch)

    return fetch
  }

  /** Drops what is cached for a workspace (it was removed), or for its pull requests not in `keep`. */
  forget(id: string, keep: PullRequest[] = []): void {
    const kept = new Set(keep.map((pr) => threadKey(id, pr.number)))

    for (const key of this.threads.keys()) {
      if (key.startsWith(`${id}:`) && !kept.has(key)) this.threads.delete(key)
    }
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

    this.threads.set(threadKey(ws.id, pr.number), {
      thread,
      forUpdatedAt: pr.updatedAt ?? null
    })

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

  /** The branches que may ask about for a workspace: each it has had checked out, never a protected one. */
  private heads(ws: Workspace): string[] {
    const project = this.opts.workspaces.project(ws.projectId)
    const { protectedBranches } = this.opts.config()

    return withBranch(ws.branches, ws.branch).filter(
      (b) => !isProtectedBranch(b, project.defaultBranch, protectedBranches)
    )
  }

  /**
   * Checks one project's workspaces with one listing, grouped by head branch. A
   * branch missing from a full page (LIST_LIMIT) may hold an older pull
   * request, so it is asked about on its own. A workspace with no branch to ask
   * about still has the pull requests it created looked up. `due`: a settled
   * pull request is re-checked on this tick.
   */
  private async checkProject(list: Workspace[], due: boolean): Promise<void> {
    const asking = list.find((ws) => this.heads(ws).length > 0)
    const byBranch = new Map<string, GhPullRequest[]>()
    let full = false

    if (asking) {
      let items: unknown[]

      try {
        items = await ghPrList(null, asking.path, this.poller.signal)
      } catch (err) {
        for (const ws of list) this.failed(ws, errorMessage(err))

        return
      }

      full = items.length >= LIST_LIMIT

      for (const item of items) {
        const pr = decodePullRequest(item)

        if (!pr?.headRefName) continue
        const prs = byBranch.get(pr.headRefName)

        if (prs) prs.push(pr)
        else byBranch.set(pr.headRefName, [pr])
      }
    }

    for (const ws of list) {
      if (this.stopped) return
      await this.checkHeads(ws, due, (head) =>
        byBranch.has(head) || !full ? (byBranch.get(head) ?? []) : this.list(ws, head)
      )
    }
  }

  private checkOne(ws: Workspace, due: boolean): Promise<void> {
    return this.checkHeads(ws, due, (head) => this.list(ws, head))
  }

  /** Settles a workspace with the pull requests `listed` finds on each of its heads; none when one listing failed. */
  private async checkHeads(
    ws: Workspace,
    due: boolean,
    listed: (head: string) => GhPullRequest[] | Promise<GhPullRequest[] | null>
  ): Promise<void> {
    const raw: GhPullRequest[] = []

    for (const head of this.heads(ws)) {
      const prs = await listed(head)

      if (prs === null) return
      raw.push(...prs)
    }

    if (!this.stopped) await this.settle(ws, raw, due)
  }

  /** The pull requests whose head is `branch`; null when gh failed (logged) or the service stopped. */
  private async list(ws: Workspace, branch: string): Promise<GhPullRequest[] | null> {
    try {
      const items = await ghPrList(branch, ws.path, this.poller.signal)

      return this.stopped ? null : decodePullRequests(items)
    } catch (err) {
      this.failed(ws, errorMessage(err))

      return null
    }
  }

  /** Logs a workspace's first failed check (until one succeeds). */
  private failed(ws: Workspace, message: string): void {
    if (this.stopped || this.failing.has(ws.id)) return
    this.failing.add(ws.id)
    this.opts.log?.(`pr check failed for ${ws.id}: ${message}`)
  }

  /**
   * The pull requests the session created (prUrls) that are not among
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

    for (const url of ws.prUrls) {
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
   * branches, joined with those the session created elsewhere and those stored
   * before, and the current one among them.
   */
  private async settle(ws: Workspace, raw: GhPullRequest[], due: boolean): Promise<void> {
    const checkedAt = new Date().toISOString()
    const onBranch = raw.map((r) => parsePullRequest(r, checkedAt))
    const extra = await this.linked(ws, onBranch, due, checkedAt)

    if (this.stopped) return

    if (extra.error !== null) this.failed(ws, extra.error)
    else if (this.failing.delete(ws.id)) this.opts.log?.(`pr check recovered for ${ws.id}`)
    const current = this.opts.store.getWorkspace(ws.id)

    if (!current || current.archivedAt) return
    const prs = pullRequestList([...onBranch, ...extra.prs], current.prs)
    const next = currentPullRequest(prs)
    this.forget(ws.id, prs)

    if (samePullRequests(current.prs, prs)) return
    this.opts.store.setWorkspacePrs(ws.id, prs)
    this.opts.bus.emit('workspace.updated', { ...current, pr: next, prs })
  }

  /**
   * Records the pull requests a hook event shows the workspace's session (or one of its
   * subagents) creating with `gh pr create` on the project's origin, and checks them now.
   */
  hook(id: string, event: HookEvent): Promise<void> {
    if (this.stopped || !prCreateCall(event)) return Promise.resolve()
    const recorded = this.recording.then(() => this.record(id, event))
    this.recording = recorded.then(
      () => {},
      () => {}
    )

    return recorded.then((added) => (added ? this.refresh(id) : undefined))
  }

  /** Stores what the hook shows created; true when one was new. */
  private async record(id: string, event: HookEvent): Promise<boolean> {
    const ws = this.opts.store.getWorkspace(id)

    if (!ws || ws.archivedAt) return false
    const project = this.opts.workspaces.project(ws.projectId)
    const origin = await git(project.path, ['remote', 'get-url', 'origin'], 10_000)
    const urls = origin.ok ? createdPullRequests(event, origin.stdout) : []

    if (urls.length === 0 || !this.opts.store.addWorkspacePrUrls(id, urls)) return false
    this.opts.log?.(`workspace ${id} created ${urls.join(', ')}`)
    this.opts.bus.emit('workspace.updated', this.opts.workspaces.get(id))

    return true
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

    store.addWorkspacePrUrls(ws.id, [result.prUrl])
    this.opts.bus.emit('workspace.updated', workspaces.get(ws.id))
    void this.refresh(ws.id)

    return { prUrl: result.prUrl }
  }
}
