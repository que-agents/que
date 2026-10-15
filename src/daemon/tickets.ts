// The ticket queue: polls the user's issue tracker through `acli` (read only),
// caches the tickets assigned to them, and turns one into a workspace with a
// brief and a claude session on it.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { UserConfig } from '../shared/config'
import { cleanSpawnEnv } from '../shared/env'
import { ErrorCodes } from '../shared/protocol'
import type {
  TicketsListResult,
  TicketsStartParams,
  TicketsStartResult,
  WorkspaceCreateParams
} from '../shared/protocol'
import { slugify, workspaceSlug } from '../shared/slug'
import type { Project, Ticket, Workspace } from '../shared/types'
import { adfToText } from './adf-text'
import { RpcError } from './errors'
import type { Emit } from './status'
import type { Store } from './store'
import { shQuote } from './wrapper'
import { git } from './workspaces'

const SEARCH_FIELDS = 'key,summary,status,priority,issuetype,assignee,project,labels,updated'
const VIEW_FIELDS = 'summary,description,status,priority,issuetype,labels,project'
const SEARCH_LIMIT = '200'
const FIRST_SYNC_MS = 1000
const KV_LAST_SYNC = 'tickets.last_sync_at'
const KV_ERROR = 'tickets.error'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** One issue from `acli jira workitem search/view --json`, or null without a key and summary. */
export function parseIssue(raw: unknown, syncedAt: string): Ticket | null {
  const issue = obj(raw)
  const fields = obj(issue.fields)
  const key = str(issue.key)
  const summary = str(fields.summary)
  if (!key || !summary) return null
  const status = obj(fields.status)
  const category = obj(status.statusCategory).key
  let url = ''
  try {
    const self = str(issue.self)
    if (self) url = `https://${new URL(self).host}/browse/${key}`
  } catch {
    // No usable `self`: no link.
  }
  const project = obj(fields.project)
  const prefix = key.split('-')[0]
  const labels = Array.isArray(fields.labels)
    ? fields.labels.filter((l): l is string => typeof l === 'string')
    : []
  return {
    key,
    summary,
    status: str(status.name) ?? 'Unknown',
    statusCategory:
      category === 'new' || category === 'indeterminate' || category === 'done'
        ? category
        : 'unknown',
    priority: str(obj(fields.priority).name),
    type: str(obj(fields.issuetype).name) ?? 'Task',
    assignee: str(obj(fields.assignee).displayName),
    projectKey: str(project.key) ?? prefix,
    projectName: str(project.name) ?? str(project.key) ?? prefix,
    url,
    labels,
    updatedAt: str(fields.updated),
    syncedAt,
    workspaceId: null
  }
}

/** The brief a workspace's `.que/ticket.md` holds. */
export function renderBrief(ticket: Ticket, description: string): string {
  const lines = [
    `# ${ticket.key} ${ticket.summary}`,
    '',
    ticket.url,
    `Status: ${ticket.status} · Priority: ${ticket.priority ?? 'none'} · Type: ${ticket.type}`
  ]
  if (ticket.labels.length > 0) lines.push(`Labels: ${ticket.labels.join(', ')}`)
  lines.push('', '## Description', '', description.trim() || '(none)', '')
  return lines.join('\n')
}

/** `<key lowercased>-<slug of summary>`, at most 64 characters, no trailing hyphen. */
export function workspaceNameFor(ticket: Ticket): string {
  const key = ticket.key.toLowerCase()
  const capped = slugify(`${key}-${ticket.summary}`)
    .slice(0, 64)
    .replace(/[-._]+$/, '')
  return workspaceSlug(capped) ?? key
}

function acli(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'acli',
      args,
      {
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 32 * 1024 * 1024,
        env: cleanSpawnEnv(process.env),
        signal
      },
      (err, stdout, stderr) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return reject(new Error('acli is not installed or not on PATH'))
          }
          const first = (s: string) => s.trim().split('\n')[0]?.trim() ?? ''
          return reject(new Error(first(String(stderr)) || first(String(stdout)) || err.message))
        }
        resolvePromise(stdout)
      }
    ).stdin?.end()
  })
}

export interface TicketServiceOptions {
  store: Store
  config: () => UserConfig
  emit: Emit
  log?: (msg: string) => void
  now?: () => number
  /** Overrides the poll interval (otherwise `jira.poll_minutes`, at least 100 ms). */
  pollMs?: number
  /** QUE_HOME: briefs for loose sessions go under `<home>/tickets/`. */
  home: string
  projects: () => Project[]
  createWorkspace: (p: WorkspaceCreateParams) => Promise<Workspace>
  openTerminal: (workspaceId: string) => Promise<{ id: string }>
  createSession: (cwd: string) => Promise<{ id: string }>
  writeTerminal: (id: string, data: string) => void
  /** Records `tracker key = que project name` in the config file. */
  learnProject: (projectKey: string, projectName: string) => Promise<void>
}

export class TicketService {
  private timer: NodeJS.Timeout | null = null
  private stopped = true
  private abort = new AbortController()
  private inflight = new Set<Promise<unknown>>()
  private running: Promise<void> | null = null
  private failing = false
  private readonly now: () => number

  constructor(private opts: TicketServiceOptions) {
    this.now = opts.now ?? Date.now
  }

  start(): void {
    if (this.abort.signal.aborted) this.abort = new AbortController()
    this.stopped = false
    this.schedule(FIRST_SYNC_MS)
  }

  stop(): void {
    this.stopped = true
    this.abort.abort()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Resolves once every call that was running when stop() was called has ended. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.inflight])
  }

  private schedule(ms?: number): void {
    if (this.stopped) return
    const wait =
      ms ?? this.opts.pollMs ?? Math.max(100, this.opts.config().jira.pollMinutes * 60_000)
    this.timer = setTimeout(() => {
      void this.sync().finally(() => this.schedule())
    }, wait)
    this.timer.unref()
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.inflight.add(p)
    const done = () => this.inflight.delete(p)
    p.then(done, done)
    return p
  }

  /** The cached tickets and how the last sync went; never touches the network. */
  list(): TicketsListResult {
    const tickets = this.opts.store.listTickets()
    return {
      tickets,
      sync: {
        lastSyncAt: this.opts.store.getKv(KV_LAST_SYNC) ?? null,
        error: this.opts.store.getKv(KV_ERROR) ?? null,
        count: tickets.length
      }
    }
  }

  /** Fetches the queue now and returns the result (a failure shows in `sync.error`). */
  async sync(): Promise<TicketsListResult> {
    if (this.stopped) return this.list()
    if (!this.running) {
      this.running = this.track(this.syncOnce()).finally(() => {
        this.running = null
      })
    }
    await this.running
    return this.list()
  }

  private async syncOnce(): Promise<void> {
    const { store } = this.opts
    let issues: unknown[]
    try {
      const stdout = await acli(
        [
          'jira',
          'workitem',
          'search',
          '--jql',
          this.opts.config().jira.jql,
          '--json',
          '--limit',
          SEARCH_LIMIT,
          '--fields',
          SEARCH_FIELDS
        ],
        this.abort.signal
      )
      let parsed: unknown
      try {
        parsed = JSON.parse(stdout)
      } catch {
        throw new Error('acli printed output that is not JSON')
      }
      if (!Array.isArray(parsed)) throw new Error('acli printed output that is not a list')
      issues = parsed
    } catch (err) {
      if (this.stopped) return
      const message = (err as Error).message
      store.setKv(KV_ERROR, message)
      if (!this.failing) {
        this.failing = true
        this.opts.log?.(`ticket sync failed: ${message}`)
      }
      this.opts.emit('tickets.synced', this.list())
      return
    }
    if (this.stopped) return
    const at = new Date(this.now()).toISOString()
    const tickets = issues.flatMap((i) => parseIssue(i, at) ?? [])
    store.upsertTickets(tickets)
    store.deleteTicketsNotIn(tickets.map((t) => t.key))
    store.setKv(KV_ERROR, null)
    store.setKv(KV_LAST_SYNC, at)
    if (this.failing) {
      this.failing = false
      this.opts.log?.('ticket sync recovered')
    }
    this.opts.emit('tickets.synced', this.list())
  }

  /** The id of the que project a ticket's tracker project is mapped to, or null. */
  projectFor(key: string): string | null {
    const ticket = this.opts.store.getTicket(key)
    if (!ticket) return null
    return this.mappedProject(ticket)?.id ?? null
  }

  private mappedProject(ticket: Ticket): Project | null {
    const name = this.opts.config().jira.projects[ticket.projectKey]
    if (!name) return null
    return this.opts.projects().find((p) => p.name === name) ?? null
  }

  private async brief(ticket: Ticket): Promise<string> {
    let description = '(could not be fetched)'
    try {
      const stdout = await acli(
        ['jira', 'workitem', 'view', ticket.key, '--json', '--fields', VIEW_FIELDS],
        this.abort.signal
      )
      description = adfToText(obj(obj(JSON.parse(stdout)).fields).description)
    } catch (err) {
      this.opts.log?.(`fetching ${ticket.key} failed: ${(err as Error).message}`)
    }
    return renderBrief(ticket, description)
  }

  /** Starts work on a ticket: a workspace under its project, or a loose session. */
  startTicket(params: TicketsStartParams): Promise<TicketsStartResult> {
    return this.track(this.startOnce(params))
  }

  private async startOnce(params: TicketsStartParams): Promise<TicketsStartResult> {
    const { store, home } = this.opts
    const ticket = store.getTicket(params.key)
    if (!ticket) throw new RpcError(ErrorCodes.NotFound, `no ticket ${params.key}`)
    const brief = await this.brief(ticket)

    if (params.session) {
      const dir = join(home, 'tickets')
      fs.mkdirSync(dir, { recursive: true })
      const file = join(dir, `${ticket.key}.md`)
      fs.writeFileSync(file, brief)
      const t = await this.opts.createSession(os.homedir())
      const prompt = `Read ${file}, the ticket I am working on. Restate the goal in a sentence, then propose a plan before changing anything.`
      this.opts.writeTerminal(t.id, `claude ${shQuote(prompt)}\r`)
      return { kind: 'session', terminalId: t.id }
    }

    const mapped = this.mappedProject(ticket)
    const projects = this.opts.projects()
    const project = params.projectId ? projects.find((p) => p.id === params.projectId) : mapped
    if (params.projectId && !project) {
      throw new RpcError(ErrorCodes.NotFound, `no project ${params.projectId}`)
    }
    if (!project) return { kind: 'needs_project', projects }

    if (mapped?.id !== project.id) await this.opts.learnProject(ticket.projectKey, project.name)

    const name = workspaceNameFor(ticket)
    const existing = store
      .listWorkspaces()
      .find((w) => w.projectId === project.id && w.name === name && !w.archivedAt)
    const workspace = existing ?? (await this.opts.createWorkspace({ projectId: project.id, name }))

    const dir = join(workspace.path, '.que')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(join(dir, 'ticket.md'), brief)
    await this.excludeQueDir(workspace.path)
    store.setTicketWorkspace(ticket.key, workspace.id)

    const t = await this.opts.openTerminal(workspace.id)
    this.opts.writeTerminal(t.id, `claude ${shQuote(this.opts.config().jira.startPrompt)}\r`)
    this.opts.emit('tickets.synced', this.list())
    return { kind: 'workspace', workspace }
  }

  /** Keeps `.que/` out of `git status` through the repository's exclude file. */
  private async excludeQueDir(worktree: string): Promise<void> {
    const r = await git(worktree, ['rev-parse', '--git-path', 'info/exclude'])
    if (!r.ok || !r.stdout) return
    const file = resolve(worktree, r.stdout)
    let current = ''
    try {
      current = fs.readFileSync(file, 'utf8')
    } catch {
      // Created below.
    }
    if (current.split('\n').some((l) => l.trim() === '.que/')) return
    fs.mkdirSync(dirname(file), { recursive: true })
    fs.writeFileSync(file, `${current}${current && !current.endsWith('\n') ? '\n' : ''}.que/\n`)
  }
}
