// SQLite store (node:sqlite) for projects, workspaces, hook events, tasks, and kv. A
// small typed layer over prepared statements; migrations are numbered and
// recorded in the `migrations` table.
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type {
  Project,
  QuietUnlock,
  Task,
  TaskSource,
  TaskState,
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
   );`
]

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/** `<prefix>` + 12 random base32 characters. */
export function newId(prefix: 'prj_' | 'ws_' | 'tsk_'): string {
  const bytes = randomBytes(12)
  let out = prefix
  for (const b of bytes) out += ID_ALPHABET[b & 31]
  return out
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
}

interface TaskRow {
  id: string
  project_id: string
  workspace_id: string | null
  title: string
  brief: string
  source: string
  resume_session_id: string | null
  state: string
  reason: string | null
  session_id: string | null
  pid: number | null
  attempts: number
  cost_usd: number
  turns: number
  max_turns: number
  max_budget_usd: number
  permission_mode: string | null
  branch: string | null
  pr_url: string | null
  result_text: string | null
  last_activity_at: string | null
  started_at: string | null
  finished_at: string | null
  paused_until: string | null
  created_at: string
  updated_at: string
}

/** Task field → column, in insert order. */
const TASK_COLUMNS: Array<[keyof Task, keyof TaskRow]> = [
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

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    projectId: r.project_id,
    workspaceId: r.workspace_id,
    title: r.title,
    brief: r.brief,
    source: r.source as TaskSource,
    resumeSessionId: r.resume_session_id,
    state: r.state as TaskState,
    reason: r.reason,
    sessionId: r.session_id,
    pid: r.pid,
    attempts: r.attempts,
    costUsd: r.cost_usd,
    turns: r.turns,
    maxTurns: r.max_turns,
    maxBudgetUsd: r.max_budget_usd,
    permissionMode: r.permission_mode,
    branch: r.branch,
    prUrl: r.pr_url,
    resultText: r.result_text,
    lastActivityAt: r.last_activity_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    pausedUntil: r.paused_until,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
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
    pr: null
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

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
    )
    const row = this.db.prepare('SELECT MAX(version) AS v FROM migrations').get() as {
      v: number | null
    }
    const current = row.v ?? 0
    for (let i = current; i < MIGRATIONS.length; i++) {
      this.db.exec('BEGIN')
      try {
        this.db.exec(MIGRATIONS[i])
        this.db
          .prepare('INSERT INTO migrations (version, applied_at) VALUES (?, ?)')
          .run(i + 1, new Date().toISOString())
        this.db.exec('COMMIT')
      } catch (err) {
        this.db.exec('ROLLBACK')
        throw err
      }
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close()
  }

  // ---- projects -------------------------------------------------------------

  insertProject(p: Project): void {
    this.db
      .prepare(
        'INSERT INTO projects (id, name, path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(p.id, p.name, p.path, p.defaultBranch, p.createdAt)
  }

  getProject(id: string): Project | undefined {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
    return r ? toProject(r as unknown as ProjectRow) : undefined
  }

  getProjectByPath(path: string): Project | undefined {
    const r = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path)
    return r ? toProject(r as unknown as ProjectRow) : undefined
  }

  listProjects(): Project[] {
    return (
      this.db
        .prepare('SELECT * FROM projects ORDER BY created_at, id')
        .all() as unknown as ProjectRow[]
    ).map(toProject)
  }

  deleteProject(id: string): void {
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          'DELETE FROM hook_events WHERE workspace_id IN (SELECT id FROM workspaces WHERE project_id = ?)'
        )
        .run(id)
      this.db.prepare('DELETE FROM workspaces WHERE project_id = ?').run(id)
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // ---- workspaces -----------------------------------------------------------

  insertWorkspace(w: Workspace): void {
    this.db
      .prepare(
        `INSERT INTO workspaces (id, project_id, name, branch, path, base_ref, status, status_reason,
           status_at, last_activity_at, session_id, created_at, archived_at, pr_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
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
        w.prUrl
      )
  }

  getWorkspace(id: string): Workspace | undefined {
    const r = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id)
    return r ? toWorkspace(r as unknown as WorkspaceRow) : undefined
  }

  /** Any workspace (archived included) holding this name or path in the project. */
  findWorkspaceConflicts(projectId: string, name: string, path: string): Workspace[] {
    return (
      this.db
        .prepare('SELECT * FROM workspaces WHERE (project_id = ? AND name = ?) OR path = ?')
        .all(projectId, name, path) as unknown as WorkspaceRow[]
    ).map(toWorkspace)
  }

  /** Unarchived workspaces, oldest first. */
  listWorkspaces(projectId?: string): Workspace[] {
    const rows = projectId
      ? this.db
          .prepare(
            'SELECT * FROM workspaces WHERE archived_at IS NULL AND project_id = ? ORDER BY created_at, id'
          )
          .all(projectId)
      : this.db
          .prepare('SELECT * FROM workspaces WHERE archived_at IS NULL ORDER BY created_at, id')
          .all()
    return (rows as unknown as WorkspaceRow[]).map(toWorkspace)
  }

  updateStatus(id: string, u: StatusUpdate): void {
    this.db
      .prepare(
        `UPDATE workspaces SET status = ?, status_reason = ?, status_at = ?, last_activity_at = ?,
           session_id = ? WHERE id = ?`
      )
      .run(u.status, u.reason, u.at, u.lastActivityAt, u.sessionId, id)
  }

  setWorkspacePrUrl(id: string, prUrl: string): void {
    this.db.prepare('UPDATE workspaces SET pr_url = ? WHERE id = ?').run(prUrl, id)
  }

  archiveWorkspace(id: string, at: string): void {
    this.db.prepare('UPDATE workspaces SET archived_at = ? WHERE id = ?').run(at, id)
  }

  /** Hard-deletes an archived row so its name and path can be reused. */
  deleteWorkspace(id: string): void {
    this.db.prepare('DELETE FROM hook_events WHERE workspace_id = ?').run(id)
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
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
    this.db
      .prepare(
        'INSERT INTO hook_events (workspace_id, session_id, event, payload, received_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(workspaceId, sessionId, event, JSON.stringify(payload), receivedAt)
    this.db
      .prepare(
        `DELETE FROM hook_events WHERE workspace_id = ? AND id NOT IN
           (SELECT id FROM hook_events WHERE workspace_id = ? ORDER BY id DESC LIMIT ?)`
      )
      .run(workspaceId, workspaceId, HOOK_EVENTS_PER_WORKSPACE)
  }

  listHookEvents(workspaceId: string): HookEventRow[] {
    return (
      this.db
        .prepare('SELECT * FROM hook_events WHERE workspace_id = ? ORDER BY id')
        .all(workspaceId) as unknown as Array<{
        id: number
        workspace_id: string
        session_id: string | null
        event: string
        payload: string
        received_at: string
      }>
    ).map((r) => ({
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
    const cols = TASK_COLUMNS.map(([, c]) => c)
    this.db
      .prepare(`INSERT INTO tasks (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...TASK_COLUMNS.map(([k]) => t[k]))
  }

  /** Writes every field of the task (it must exist). */
  updateTask(t: Task): void {
    const rest = TASK_COLUMNS.filter(([k]) => k !== 'id')
    this.db
      .prepare(`UPDATE tasks SET ${rest.map(([, c]) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...rest.map(([k]) => t[k]), t.id)
  }

  getTask(id: string): Task | undefined {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
    return r ? toTask(r as unknown as TaskRow) : undefined
  }

  /** Oldest first (insertion order breaks ties within a millisecond). */
  listTasks(states?: readonly TaskState[]): Task[] {
    const rows =
      states && states.length > 0
        ? this.db
            .prepare(
              `SELECT * FROM tasks WHERE state IN (${states.map(() => '?').join(', ')}) ORDER BY created_at, rowid`
            )
            .all(...states)
        : this.db.prepare('SELECT * FROM tasks ORDER BY created_at, rowid').all()
    return (rows as unknown as TaskRow[]).map(toTask)
  }

  deleteTask(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  // ---- quiet unlocks ---------------------------------------------------------

  insertUnlock(u: { at: string; minutes: number; why: string | null; until: string }): number {
    const r = this.db
      .prepare('INSERT INTO quiet_unlocks (at, minutes, why, until) VALUES (?, ?, ?, ?)')
      .run(u.at, u.minutes, u.why, u.until)
    return Number(r.lastInsertRowid)
  }

  endUnlock(id: number, endedAt: string): void {
    this.db
      .prepare('UPDATE quiet_unlocks SET ended_at = ? WHERE id = ? AND ended_at IS NULL')
      .run(endedAt, id)
  }

  /** The unlock still open (not ended), if any. */
  openUnlock(): { id: number; at: string; why: string | null; until: string } | undefined {
    const r = this.db
      .prepare(
        'SELECT id, at, why, until FROM quiet_unlocks WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1'
      )
      .get() as { id: number; at: string; why: string | null; until: string } | undefined
    return r
  }

  /** Unlocks started at or after `since`, oldest first. */
  listUnlocks(since?: string): QuietUnlock[] {
    const rows = (since
      ? this.db.prepare('SELECT * FROM quiet_unlocks WHERE at >= ? ORDER BY id').all(since)
      : this.db.prepare('SELECT * FROM quiet_unlocks ORDER BY id').all()) as unknown as Array<{
      at: string
      minutes: number
      why: string | null
      ended_at: string | null
    }>
    return rows.map((r) => ({ at: r.at, minutes: r.minutes, why: r.why, endedAt: r.ended_at }))
  }

  // ---- kv -------------------------------------------------------------------

  getKv(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return r?.value
  }

  setKv(key: string, value: string | null): void {
    if (value === null) this.db.prepare('DELETE FROM kv WHERE key = ?').run(key)
    else
      this.db
        .prepare(
          'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run(key, value)
  }
}
