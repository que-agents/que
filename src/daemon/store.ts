// SQLite store (node:sqlite) for projects, workspaces, and hook events. A
// small typed layer over prepared statements; migrations are numbered and
// recorded in the `migrations` table.
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Project, Workspace, WorkspaceStatus } from '../shared/types'

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
   CREATE INDEX hook_events_workspace ON hook_events(workspace_id, id);`
]

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/** `<prefix>` + 12 random base32 characters. */
export function newId(prefix: 'prj_' | 'ws_'): string {
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
    archivedAt: r.archived_at
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
           status_at, last_activity_at, session_id, created_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        w.archivedAt
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
}
