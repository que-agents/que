// SQLite store (node:sqlite) for projects, workspaces, hook events, tasks, and kv. A
// small typed layer over prepared statements; migrations are numbered and
// recorded in the `migrations` table.
import { randomBytes } from 'node:crypto'
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementResultingChanges,
  type StatementSync
} from 'node:sqlite'
import type {
  Project,
  PullRequest,
  QuietUnlock,
  Task,
  TaskState,
  Ticket,
  Workspace,
  WorkspaceStatus
} from '../shared/types'

const HOOK_EVENTS_PER_WORKSPACE = 500

const MIGRATIONS: string[] = [
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     path TEXT NOT NULL UNIQUE,
     default_branch TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE workspaces (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id),
     name TEXT NOT NULL,
     branch TEXT NOT NULL,
     path TEXT NOT NULL UNIQUE,
     base_ref TEXT NOT NULL,
     status TEXT NOT NULL,
     status_reason TEXT,
     status_at TEXT NOT NULL,
     last_activity_at TEXT,
     session_id TEXT,
     created_at TEXT NOT NULL,
     archived_at TEXT,
     UNIQUE(project_id, name)
   );
   CREATE TABLE hook_events (
     id INTEGER PRIMARY KEY,
     workspace_id TEXT NOT NULL,
     session_id TEXT,
     event TEXT NOT NULL,
     payload TEXT NOT NULL,
     received_at TEXT NOT NULL
   );
   CREATE INDEX hook_events_workspace ON hook_events(workspace_id, id);`,
  `CREATE TABLE tasks (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL,
     workspace_id TEXT,
     title TEXT NOT NULL,
     brief TEXT NOT NULL,
     source TEXT NOT NULL,
     resume_session_id TEXT,
     state TEXT NOT NULL,
     reason TEXT,
     session_id TEXT,
     pid INTEGER,
     attempts INTEGER NOT NULL DEFAULT 0,
     cost_usd REAL NOT NULL DEFAULT 0,
     turns INTEGER NOT NULL DEFAULT 0,
     max_turns INTEGER NOT NULL,
     max_budget_usd REAL NOT NULL,
     permission_mode TEXT,
     branch TEXT,
     pr_url TEXT,
     result_text TEXT,
     last_activity_at TEXT,
     started_at TEXT,
     finished_at TEXT,
     paused_until TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX tasks_state ON tasks(state, created_at);
   CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  `ALTER TABLE workspaces ADD COLUMN pr_url TEXT;`,
  `CREATE TABLE quiet_unlocks (
     id INTEGER PRIMARY KEY,
     at TEXT NOT NULL,
     minutes REAL NOT NULL,
     why TEXT,
     until TEXT NOT NULL,
     ended_at TEXT
   );`,
  `ALTER TABLE workspaces ADD COLUMN pr_json TEXT;`,
  `CREATE TABLE workspace_status_log (
     id INTEGER PRIMARY KEY,
     workspace_id TEXT NOT NULL,
     status TEXT NOT NULL,
     reason TEXT,
     at TEXT NOT NULL
   );
   CREATE INDEX workspace_status_log_ws ON workspace_status_log(workspace_id, at);
   INSERT INTO workspace_status_log (workspace_id, status, reason, at)
     SELECT id, status, status_reason, status_at FROM workspaces;`,
  `CREATE TABLE tickets (
     key TEXT PRIMARY KEY,
     summary TEXT NOT NULL,
     status TEXT NOT NULL,
     status_category TEXT NOT NULL,
     priority TEXT,
     type TEXT NOT NULL,
     assignee TEXT,
     project_key TEXT NOT NULL,
     project_name TEXT NOT NULL,
     url TEXT NOT NULL,
     labels_json TEXT NOT NULL,
     updated_at TEXT,
     synced_at TEXT NOT NULL,
     workspace_id TEXT
   );`,
  `ALTER TABLE tickets ADD COLUMN position INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE tickets ADD COLUMN parent_key TEXT;`,
  `ALTER TABLE tickets ADD COLUMN level TEXT NOT NULL DEFAULT 'standard';`,
  `ALTER TABLE tickets ADD COLUMN assigned INTEGER NOT NULL DEFAULT 1;`,
  `ALTER TABLE tickets ADD COLUMN parent_checked_at TEXT;`
]

const STATUS_LOG_RETENTION_MS = 30 * 24 * 3_600_000

export interface StatusLogRow {
  status: WorkspaceStatus
  reason: string | null
  at: string
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/** `<prefix>` + 12 random base32 characters. */
export function newId(prefix: 'prj_' | 'ws_' | 'tsk_'): string {
  const bytes = randomBytes(12)
  let out = prefix

  for (const b of bytes) out += ID_ALPHABET[b & 31]

  return out
}

interface TicketRow {
  parent_key: string | null
  parent_checked_at: string | null
  level: string
  assigned: number
  key: string
  summary: string
  status: string
  status_category: string
  priority: string | null
  type: string
  assignee: string | null
  project_key: string
  project_name: string
  url: string
  labels_json: string
  updated_at: string | null
  synced_at: string
  workspace_id: string | null
}

function ticketFromRow(r: TicketRow): Ticket {
  let labels: string[] = []

  try {
    const parsed = JSON.parse(r.labels_json) as unknown

    if (Array.isArray(parsed)) labels = parsed.filter((l): l is string => typeof l === 'string')
  } catch {
    // Unreadable labels are no labels.
  }

  return {
    parentKey: r.parent_key ?? null,
    level: r.level === 'epic' || r.level === 'subtask' ? r.level : 'standard',
    assigned: r.assigned !== 0,
    key: r.key,
    summary: r.summary,
    status: r.status,
    statusCategory: r.status_category as Ticket['statusCategory'],
    priority: r.priority,
    type: r.type,
    assignee: r.assignee,
    projectKey: r.project_key,
    projectName: r.project_name,
    url: r.url,
    labels,
    updatedAt: r.updated_at,
    syncedAt: r.synced_at,
    workspaceId: r.workspace_id
  }
}

interface ProjectRow {
  id: string
  name: string
  path: string
  default_branch: string
  created_at: string
}

interface WorkspaceRow {
  id: string
  project_id: string
  name: string
  branch: string
  path: string
  base_ref: string
  status: string
  status_reason: string | null
  status_at: string
  last_activity_at: string | null
  session_id: string | null
  created_at: string
  archived_at: string | null
  pr_url: string | null
  pr_json: string | null
}

/** Task field → column, in insert order. */
const TASK_COLUMNS: Array<[keyof Task, string]> = [
  ['id', 'id'],
  ['projectId', 'project_id'],
  ['workspaceId', 'workspace_id'],
  ['title', 'title'],
  ['brief', 'brief'],
  ['source', 'source'],
  ['resumeSessionId', 'resume_session_id'],
  ['state', 'state'],
  ['reason', 'reason'],
  ['sessionId', 'session_id'],
  ['pid', 'pid'],
  ['attempts', 'attempts'],
  ['costUsd', 'cost_usd'],
  ['turns', 'turns'],
  ['maxTurns', 'max_turns'],
  ['maxBudgetUsd', 'max_budget_usd'],
  ['permissionMode', 'permission_mode'],
  ['branch', 'branch'],
  ['prUrl', 'pr_url'],
  ['resultText', 'result_text'],
  ['lastActivityAt', 'last_activity_at'],
  ['startedAt', 'started_at'],
  ['finishedAt', 'finished_at'],
  ['pausedUntil', 'paused_until'],
  ['createdAt', 'created_at'],
  ['updatedAt', 'updated_at']
]

const INSERT_TASK_SQL = `INSERT INTO tasks (${TASK_COLUMNS.map(([, c]) => c).join(', ')})
  VALUES (${TASK_COLUMNS.map(() => '?').join(', ')})`

const TASK_FIELDS_BUT_ID = TASK_COLUMNS.filter(([k]) => k !== 'id')

const UPDATE_TASK_SQL = `UPDATE tasks SET ${TASK_FIELDS_BUT_ID.map(([, c]) => `${c} = ?`).join(', ')}
  WHERE id = ?`

/** Selects a tasks row as a Task: each column comes back under its field name, in column order. */
const SELECT_TASK = `SELECT ${TASK_COLUMNS.map(([k, c]) => `${c} AS ${k}`).join(', ')} FROM tasks`

/** node:sqlite rows have a null prototype; a Task is a plain object. */
function toTask(r: Task): Task {
  return { ...r }
}

export interface HookEventRow {
  id: number
  workspaceId: string
  sessionId: string | null
  event: string
  payload: string
  receivedAt: string
}

function toProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    defaultBranch: r.default_branch,
    createdAt: r.created_at
  }
}

function parsePr(json: string | null): PullRequest | null {
  if (!json) return null

  try {
    const v = JSON.parse(json) as unknown

    return v && typeof v === 'object' ? (v as PullRequest) : null
  } catch {
    return null
  }
}

function toWorkspace(r: WorkspaceRow): Workspace {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    branch: r.branch,
    path: r.path,
    baseRef: r.base_ref,
    status: r.status as WorkspaceStatus,
    statusReason: r.status_reason,
    statusAt: r.status_at,
    lastActivityAt: r.last_activity_at,
    sessionId: r.session_id,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
    prUrl: r.pr_url ?? null,
    pr: parsePr(r.pr_json)
  }
}

export interface StatusUpdate {
  status: WorkspaceStatus
  reason: string | null
  at: string
  lastActivityAt: string | null
  sessionId: string | null
}

export class Store {
  readonly db: DatabaseSync

  private readonly statements = new Map<string, StatementSync>()

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
    )

    const current =
      this.row<{ v: number | null }>('SELECT MAX(version) AS v FROM migrations')?.v ?? 0

    for (let i = current; i < MIGRATIONS.length; i++) {
      this.tx(() => {
        this.db.exec(MIGRATIONS[i])
        this.run(
          'INSERT INTO migrations (version, applied_at) VALUES (?, ?)',
          i + 1,
          new Date().toISOString()
        )
      })
    }
  }

  close(): void {
    this.statements.clear()

    if (this.db.isOpen) this.db.close()
  }

  /** The compiled statement for this SQL, prepared once per connection. */
  private statement(sql: string): StatementSync {
    let stmt = this.statements.get(sql)

    if (!stmt) {
      stmt = this.db.prepare(sql)
      this.statements.set(sql, stmt)
    }

    return stmt
  }

  /** Runs a write statement. */
  private run(sql: string, ...params: SQLInputValue[]): StatementResultingChanges {
    return this.statement(sql).run(...params)
  }

  /** Runs `fn` in one transaction, rolled back if it throws. */
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN')

    try {
      const out = fn()

      this.db.exec('COMMIT')

      return out
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // ---- projects -------------------------------------------------------------

  insertProject(p: Project): void {
    this.run(
      'INSERT INTO projects (id, name, path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)',
      p.id,
      p.name,
      p.path,
      p.defaultBranch,
      p.createdAt
    )
  }

  /**
   * Rows from a SELECT, typed by the caller. node:sqlite returns untyped records;
   * the SELECT fixes the columns, so the row type is asserted once, here.
   */
  private rows<Row>(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.statement(sql).all(...params) as Row[]
  }

  /** The first row of a SELECT, typed by the caller (see rows). */
  private row<Row>(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.statement(sql).get(...params) as Row | undefined
  }

  getProject(id: string): Project | undefined {
    const r = this.row<ProjectRow>('SELECT * FROM projects WHERE id = ?', id)

    return r ? toProject(r) : undefined
  }

  getProjectByPath(path: string): Project | undefined {
    const r = this.row<ProjectRow>('SELECT * FROM projects WHERE path = ?', path)

    return r ? toProject(r) : undefined
  }

  listProjects(): Project[] {
    return this.rows<ProjectRow>('SELECT * FROM projects ORDER BY created_at, id').map(toProject)
  }

  deleteProject(id: string): void {
    this.tx(() => {
      this.run(
        'DELETE FROM hook_events WHERE workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)',
        id
      )
      this.run('DELETE FROM workspaces WHERE project_id = ?', id)
      this.run('DELETE FROM projects WHERE id = ?', id)
    })
  }

  // ---- workspaces -----------------------------------------------------------

  insertWorkspace(w: Workspace): void {
    this.run(
      `INSERT INTO workspaces (id, project_id, name, branch, path, base_ref, status, status_reason,
           status_at, last_activity_at, session_id, created_at, archived_at, pr_url, pr_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      w.id,
      w.projectId,
      w.name,
      w.branch,
      w.path,
      w.baseRef,
      w.status,
      w.statusReason,
      w.statusAt,
      w.lastActivityAt,
      w.sessionId,
      w.createdAt,
      w.archivedAt,
      w.prUrl,
      w.pr ? JSON.stringify(w.pr) : null
    )
  }

  getWorkspace(id: string): Workspace | undefined {
    const r = this.row<WorkspaceRow>('SELECT * FROM workspaces WHERE id = ?', id)

    return r ? toWorkspace(r) : undefined
  }

  /** Any workspace (archived included) holding this name or path in the project. */
  findWorkspaceConflicts(projectId: string, name: string, path: string): Workspace[] {
    return this.rows<WorkspaceRow>(
      'SELECT * FROM workspaces WHERE (project_id = ? AND name = ?) OR path = ?',
      projectId,
      name,
      path
    ).map(toWorkspace)
  }

  /** Unarchived workspaces, oldest first. */
  listWorkspaces(projectId?: string): Workspace[] {
    const rows = projectId
      ? this.rows<WorkspaceRow>(
          'SELECT * FROM workspaces WHERE archived_at IS NULL AND project_id = ? ORDER BY created_at, id',
          projectId
        )
      : this.rows<WorkspaceRow>(
          'SELECT * FROM workspaces WHERE archived_at IS NULL ORDER BY created_at, id'
        )

    return rows.map(toWorkspace)
  }

  updateStatus(id: string, u: StatusUpdate): void {
    this.run(
      `UPDATE workspaces SET status = ?, status_reason = ?, status_at = ?, last_activity_at = ?,
           session_id = ? WHERE id = ?`,
      u.status,
      u.reason,
      u.at,
      u.lastActivityAt,
      u.sessionId,
      id
    )
  }

  setWorkspacePrUrl(id: string, prUrl: string): void {
    this.run('UPDATE workspaces SET pr_url = ? WHERE id = ?', prUrl, id)
  }

  setWorkspacePr(id: string, pr: PullRequest | null): void {
    this.run('UPDATE workspaces SET pr_json = ? WHERE id = ?', pr ? JSON.stringify(pr) : null, id)
  }

  archiveWorkspace(id: string, at: string): void {
    this.run('UPDATE workspaces SET archived_at = ? WHERE id = ?', at, id)
  }

  /** Hard-deletes an archived row so its name and path can be reused. */
  deleteWorkspace(id: string): void {
    this.run('DELETE FROM hook_events WHERE workspace_id = ?', id)
    this.run('DELETE FROM workspace_status_log WHERE workspace_id = ?', id)
    this.run('DELETE FROM workspaces WHERE id = ?', id)
  }

  // ---- status log -----------------------------------------------------------

  /** Records one status change; rows older than 30 days are pruned on the way. */
  insertStatusLog(
    workspaceId: string,
    status: WorkspaceStatus,
    reason: string | null,
    at: string
  ): void {
    this.run(
      'INSERT INTO workspace_status_log (workspace_id, status, reason, at) VALUES (?, ?, ?, ?)',
      workspaceId,
      status,
      reason,
      at
    )
    const cutoff = new Date(Date.parse(at) - STATUS_LOG_RETENTION_MS).toISOString()
    this.run('DELETE FROM workspace_status_log WHERE at < ?', cutoff)
  }

  /** Every change at or after `since`, plus the last one before it, oldest first. */
  listStatusLog(workspaceId: string, since: string): StatusLogRow[] {
    return this.rows<StatusLogRow>(
      `SELECT status, reason, at FROM workspace_status_log
         WHERE workspace_id = ? AND (at >= ? OR id = (
           SELECT id FROM workspace_status_log WHERE workspace_id = ? AND at < ?
             ORDER BY at DESC, id DESC LIMIT 1))
         ORDER BY at, id`,
      workspaceId,
      since,
      workspaceId,
      since
    )
  }

  // ---- hook events ----------------------------------------------------------

  /** Stores one hook payload, keeping only the newest rows per workspace. */
  insertHookEvent(
    workspaceId: string,
    sessionId: string | null,
    event: string,
    payload: unknown,
    receivedAt: string
  ): void {
    this.run(
      'INSERT INTO hook_events (workspace_id, session_id, event, payload, received_at) VALUES (?, ?, ?, ?, ?)',
      workspaceId,
      sessionId,
      event,
      JSON.stringify(payload),
      receivedAt
    )
    // Everything at or below the first id past the newest 500 goes; with 500 or fewer rows
    // the subquery is NULL and nothing does. Both sides walk the (workspace_id, id) index.
    this.run(
      `DELETE FROM hook_events WHERE workspace_id = ? AND id <=
         (SELECT id FROM hook_events WHERE workspace_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`,
      workspaceId,
      workspaceId,
      HOOK_EVENTS_PER_WORKSPACE
    )
  }

  listHookEvents(workspaceId: string): HookEventRow[] {
    return this.rows<{
      id: number
      workspace_id: string
      session_id: string | null
      event: string
      payload: string
      received_at: string
    }>('SELECT * FROM hook_events WHERE workspace_id = ? ORDER BY id', workspaceId).map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      sessionId: r.session_id,
      event: r.event,
      payload: r.payload,
      receivedAt: r.received_at
    }))
  }

  // ---- tasks ----------------------------------------------------------------

  insertTask(t: Task): void {
    this.run(INSERT_TASK_SQL, ...TASK_COLUMNS.map(([k]) => t[k]))
  }

  /** Writes every field of the task (it must exist). */
  updateTask(t: Task): void {
    this.run(UPDATE_TASK_SQL, ...TASK_FIELDS_BUT_ID.map(([k]) => t[k]), t.id)
  }

  getTask(id: string): Task | undefined {
    const r = this.row<Task>(`${SELECT_TASK} WHERE id = ?`, id)

    return r ? toTask(r) : undefined
  }

  /** Oldest first (insertion order breaks ties within a millisecond). */
  listTasks(states?: readonly TaskState[]): Task[] {
    const rows =
      states && states.length > 0
        ? this.rows<Task>(
            `${SELECT_TASK} WHERE state IN (${states.map(() => '?').join(', ')}) ORDER BY created_at, rowid`,
            ...states
          )
        : this.rows<Task>(`${SELECT_TASK} ORDER BY created_at, rowid`)

    return rows.map(toTask)
  }

  deleteTask(id: string): void {
    this.run('DELETE FROM tasks WHERE id = ?', id)
  }

  // ---- quiet unlocks ---------------------------------------------------------

  insertUnlock(u: { at: string; minutes: number; why: string | null; until: string }): number {
    const r = this.run(
      'INSERT INTO quiet_unlocks (at, minutes, why, until) VALUES (?, ?, ?, ?)',
      u.at,
      u.minutes,
      u.why,
      u.until
    )

    return Number(r.lastInsertRowid)
  }

  endUnlock(id: number, endedAt: string): void {
    this.run('UPDATE quiet_unlocks SET ended_at = ? WHERE id = ? AND ended_at IS NULL', endedAt, id)
  }

  /** The unlock still open (not ended), if any. */
  openUnlock(): { id: number; at: string; why: string | null; until: string } | undefined {
    return this.row<{ id: number; at: string; why: string | null; until: string }>(
      'SELECT id, at, why, until FROM quiet_unlocks WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1'
    )
  }

  /** Unlocks started at or after `since`, oldest first. */
  listUnlocks(since?: string): QuietUnlock[] {
    type UnlockRow = { at: string; minutes: number; why: string | null; ended_at: string | null }

    const rows = since
      ? this.rows<UnlockRow>('SELECT * FROM quiet_unlocks WHERE at >= ? ORDER BY id', since)
      : this.rows<UnlockRow>('SELECT * FROM quiet_unlocks ORDER BY id')

    return rows.map((r) => ({ at: r.at, minutes: r.minutes, why: r.why, endedAt: r.ended_at }))
  }

  // ---- tickets --------------------------------------------------------------

  /** Inserts or updates tickets by key (position is the index in `tickets`), keeping the workspace and the parent check time each one has. */
  upsertTickets(tickets: Ticket[]): void {
    const stmt = this.statement(
      `INSERT INTO tickets (key, summary, status, status_category, priority, type, assignee,
         project_key, project_name, url, labels_json, updated_at, synced_at, position,
         parent_key, level, assigned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET summary = excluded.summary, status = excluded.status,
         status_category = excluded.status_category, priority = excluded.priority,
         type = excluded.type, assignee = excluded.assignee, project_key = excluded.project_key,
         project_name = excluded.project_name, url = excluded.url,
         labels_json = excluded.labels_json, updated_at = excluded.updated_at,
         synced_at = excluded.synced_at, position = excluded.position,
         parent_key = excluded.parent_key, level = excluded.level, assigned = excluded.assigned`
    )

    this.tx(() => {
      for (const [position, t] of tickets.entries()) {
        stmt.run(
          t.key,
          t.summary,
          t.status,
          t.statusCategory,
          t.priority,
          t.type,
          t.assignee,
          t.projectKey,
          t.projectName,
          t.url,
          JSON.stringify(t.labels),
          t.updatedAt,
          t.syncedAt,
          position,
          t.parentKey,
          t.level,
          t.assigned ? 1 : 0
        )
      }
    })
  }

  /** Every cached ticket, in the order of the last sync (a parent sits with its children). */
  listTickets(): Ticket[] {
    return this.rows<TicketRow>('SELECT * FROM tickets ORDER BY position, assigned DESC, key').map(
      ticketFromRow
    )
  }

  getTicket(key: string): Ticket | undefined {
    const r = this.row<TicketRow>('SELECT * FROM tickets WHERE key = ?', key)

    return r ? ticketFromRow(r) : undefined
  }

  /** When the ticket's parent was last looked up (null: never, or no such ticket). */
  getTicketParentCheckedAt(key: string): string | null {
    return (
      this.row<{ parent_checked_at: string | null }>(
        'SELECT parent_checked_at FROM tickets WHERE key = ?',
        key
      )?.parent_checked_at ?? null
    )
  }

  /** Records a ticket's parent (null: none) and when it was looked up. */
  setTicketParent(key: string, parentKey: string | null, checkedAt: string): void {
    this.run(
      'UPDATE tickets SET parent_key = ?, parent_checked_at = ? WHERE key = ?',
      parentKey,
      checkedAt,
      key
    )
  }

  /**
   * Drops tickets that are not in `keys`, except those with a workspace, and
   * the parents que knows only through children (`assigned = 0`) once no
   * remaining ticket points at them.
   */
  deleteTicketsNotIn(keys: string[]): void {
    const keep = new Set(keys)
    const del = this.statement('DELETE FROM tickets WHERE key = ?')

    const rows = this.rows<{ key: string }>(
      'SELECT key FROM tickets WHERE workspace_id IS NULL AND assigned != 0'
    )

    for (const r of rows) if (!keep.has(r.key)) del.run(r.key)
    this.run(`DELETE FROM tickets WHERE assigned = 0 AND workspace_id IS NULL
           AND key NOT IN (SELECT parent_key FROM tickets WHERE parent_key IS NOT NULL)`)
  }

  setTicketWorkspace(key: string, workspaceId: string | null): void {
    this.run('UPDATE tickets SET workspace_id = ? WHERE key = ?', workspaceId, key)
  }

  // ---- kv -------------------------------------------------------------------

  getKv(key: string): string | undefined {
    return this.row<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)?.value
  }

  setKv(key: string, value: string | null): void {
    if (value === null) this.run('DELETE FROM kv WHERE key = ?', key)
    else
      this.run(
        'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value
      )
  }

  // ---- counts ---------------------------------------------------------------

  /** How many tasks sit in each state (zero for a state with none). */
  countTasksByState(): Record<TaskState, number> {
    const counts: Record<TaskState, number> = {
      queued: 0,
      preparing: 0,
      running: 0,
      paused: 0,
      finishing: 0,
      done: 0,
      stuck: 0,
      failed: 0,
      stopped: 0
    }

    for (const r of this.rows<{ state: TaskState; n: number }>(
      'SELECT state, COUNT(*) AS n FROM tasks GROUP BY state'
    )) {
      counts[r.state] = r.n
    }

    return counts
  }

  /** Ids of the unarchived workspaces whose stored status is `status`, oldest first. */
  listWorkspaceIdsByStatus(status: WorkspaceStatus): string[] {
    return this.rows<{ id: string }>(
      'SELECT id FROM workspaces WHERE archived_at IS NULL AND status = ? ORDER BY created_at, id',
      status
    ).map((r) => r.id)
  }
}
