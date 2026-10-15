// Keeps each workspace's pull request fresh: polls `gh pr list` for the
// workspace's branch, stores what changed, and emits workspace.updated.
import { execFile } from 'node:child_process'
import type { UserConfig } from '../shared/config'
import type { Project, PullRequest, Workspace } from '../shared/types'
import { isProtectedBranch } from './finisher'
import { parsePullRequest, samePullRequest } from './pr-state'
import type { Emit } from './status'
import type { Store } from './store'

const FIELDS = 'number,url,title,state,isDraft,reviewDecision,statusCheckRollup,mergedAt,updatedAt'
/** A merged or closed pull request is only re-checked on every Nth tick. */
const SETTLED_EVERY = 5

export interface PrServiceOptions {
  store: Store
  listWorkspaces: () => Workspace[]
  projectOf: (ws: Workspace) => Project
  emit: Emit
  config: () => UserConfig
  log?: (msg: string) => void
  now?: () => number
  /** Overrides the poll interval (otherwise `pr_poll_seconds`, at least 100 ms). */
  pollMs?: number
}

function ghPrList(branch: string, cwd: string, signal: AbortSignal): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', FIELDS],
      { cwd, encoding: 'utf8', timeout: 15_000, signal },
      (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr).trim().split('\n')[0] || err.message
          return reject(new Error(detail))
        }
        try {
          const parsed = JSON.parse(stdout) as unknown
          if (!Array.isArray(parsed)) throw new Error('not a list')
          resolve(parsed)
        } catch {
          reject(new Error('gh printed output that is not JSON'))
        }
      }
    ).stdin?.end()
  })
}

export class PrService {
  private timer: NodeJS.Timeout | null = null
  private polling = false
  private stopped = true
  private tickCount = 0
  private abort = new AbortController()
  private inflight = new Set<Promise<void>>()
  /** Workspaces whose last check failed (and were logged), until one succeeds. */
  private failing = new Set<string>()
  private readonly now: () => number

  constructor(private opts: PrServiceOptions) {
    this.now = opts.now ?? Date.now
  }

  start(): void {
    if (this.abort.signal.aborted) this.abort = new AbortController()
    this.stopped = false
    this.schedulePoll()
  }

  stop(): void {
    this.stopped = true
    this.abort.abort()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedulePoll(): void {
    if (this.stopped) return
    const ms = this.opts.pollMs ?? Math.max(100, this.opts.config().prPollSeconds * 1000)
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedulePoll())
    }, ms)
    this.timer.unref()
  }

  /** One pass over every unarchived workspace, one `gh` call at a time. */
  async tick(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const n = this.tickCount++
      for (const ws of this.opts.listWorkspaces()) {
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

  /** Resolves once every check that was running when stop() was called has ended. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.inflight])
  }

  private check(ws: Workspace): Promise<void> {
    const p = this.checkOne(ws)
    this.inflight.add(p)
    return p.finally(() => this.inflight.delete(p))
  }

  private async checkOne(ws: Workspace): Promise<void> {
    const project = this.opts.projectOf(ws)
    const { protectedBranches } = this.opts.config()
    if (isProtectedBranch(ws.branch, project.defaultBranch, protectedBranches)) return
    let items: unknown[]
    try {
      items = await ghPrList(ws.branch, ws.path, this.abort.signal)
    } catch (err) {
      if (this.stopped) return
      if (!this.failing.has(ws.id)) {
        this.failing.add(ws.id)
        this.opts.log?.(`pr check failed for ${ws.id}: ${(err as Error).message}`)
      }
      return
    }
    if (this.stopped) return
    if (this.failing.delete(ws.id)) this.opts.log?.(`pr check recovered for ${ws.id}`)
    const next: PullRequest | null = parsePullRequest(items[0], new Date(this.now()).toISOString())
    const current = this.opts.store.getWorkspace(ws.id)
    if (!current || current.archivedAt) return
    if (samePullRequest(current.pr, next)) return
    this.opts.store.setWorkspacePr(ws.id, next)
    const updated = this.opts.store.getWorkspace(ws.id)
    if (updated) this.opts.emit('workspace.updated', updated)
  }
}
