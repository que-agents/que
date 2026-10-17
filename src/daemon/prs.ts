// Keeps each workspace's pull request fresh: polls `gh pr list` for the
// workspace's branch, stores what changed, and emits workspace.updated.
// Also answers workspace.prThread: the conversation is fetched on demand and
// cached until the tracker sees the pull request's updatedAt move.
import type { UserConfig } from '../shared/config'
import { firstLine, run } from '../shared/exec'
import type { JsonValue, Project, PrThread, PullRequest, Workspace } from '../shared/types'
import { ghFailed, notFound } from './errors'
import { isProtectedBranch } from './finisher'
import { parsePullRequest, samePullRequest } from './pr-state'
import { decodePullRequest } from './pr-state.decode'
import { Poller } from './poller'
import { jsonPages, parsePrThread } from './pr-thread'
import { decodeLineComments, decodePrView } from './pr-thread.decode'
import type { Emit } from './status'
import type { Store } from './store'
import { errorMessage } from '../shared/errors.decode'

const FIELDS = 'number,url,title,state,isDraft,reviewDecision,statusCheckRollup,mergedAt,updatedAt'

/** A merged or closed pull request is only re-checked on every Nth tick. */
const SETTLED_EVERY = 5

export interface PrServiceOptions {
  store: Store
  projectOf: (ws: Workspace) => Project
  emit: Emit
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

async function ghPrList(branch: string, cwd: string, signal: AbortSignal): Promise<unknown[]> {
  const parsed = await ghJson(
    ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', FIELDS],
    cwd,
    signal
  )

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

  constructor(private opts: PrServiceOptions) {}

  start(): void {
    this.poller.start()
  }

  stop(): void {
    this.poller.stop()
  }

  private get stopped(): boolean {
    return this.poller.stopped
  }

  /** One pass over every unarchived workspace, one `gh` call at a time. */
  async tick(): Promise<void> {
    if (this.polling) return
    this.polling = true

    try {
      const n = this.tickCount++

      for (const ws of this.opts.store.listWorkspaces()) {
        if (this.stopped) return
        const settled = ws.pr?.state === 'merged' || ws.pr?.state === 'closed'

        if (settled && n % SETTLED_EVERY !== 0) continue
        await this.check(ws)
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

  private async checkOne(ws: Workspace): Promise<void> {
    const project = this.opts.projectOf(ws)
    const { protectedBranches } = this.opts.config()

    if (isProtectedBranch(ws.branch, project.defaultBranch, protectedBranches)) return
    let items: unknown[]

    try {
      items = await ghPrList(ws.branch, ws.path, this.poller.signal)
    } catch (err) {
      if (this.stopped) return

      if (!this.failing.has(ws.id)) {
        this.failing.add(ws.id)
        this.opts.log?.(`pr check failed for ${ws.id}: ${errorMessage(err)}`)
      }

      return
    }

    if (this.stopped) return

    if (this.failing.delete(ws.id)) this.opts.log?.(`pr check recovered for ${ws.id}`)
    const raw = decodePullRequest(items[0])
    const next = raw && parsePullRequest(raw, new Date().toISOString())
    const current = this.opts.store.getWorkspace(ws.id)

    if (!current || current.archivedAt) return

    if (!next) this.threads.delete(ws.id)

    if (samePullRequest(current.pr, next)) return
    this.opts.store.setWorkspacePr(ws.id, next)
    const updated = this.opts.store.getWorkspace(ws.id)

    if (updated) this.opts.emit('workspace.updated', updated)
  }
}
