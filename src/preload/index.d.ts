import type {
  Events,
  ProjectAddParams,
  ProjectRemoveParams,
  TermAttachResult,
  TermCreateParams,
  TermInfo,
  TermListParams,
  TermSnapshotResult,
  WorkspaceCreateParams,
  WorkspaceListParams,
  WorkspaceOpenTerminalParams,
  WorkspaceRemoveParams,
  WorkspaceStatusEvent
} from '../shared/protocol'
import type { Project, Task, Workspace, WorkspaceStatus } from '../shared/types'

export type {
  Events,
  Project,
  Task,
  TermAttachResult,
  TermCreateParams,
  TermInfo,
  TermSnapshotResult,
  Workspace,
  WorkspaceStatus,
  WorkspaceStatusEvent
}

/** Mirrors the daemon's term.* protocol methods and events. */
export interface TermApi {
  create(params: TermCreateParams): Promise<{ id: string }>
  list(params?: TermListParams): Promise<TermInfo[]>
  attach(params: { id: string; cols: number; rows: number }): Promise<TermAttachResult>
  detach(params: { id: string }): Promise<{ ok: true }>
  write(params: { id: string; data: string }): void
  resize(params: { id: string; cols: number; rows: number }): Promise<{ ok: true }>
  kill(params: { id: string }): Promise<{ ok: true }>
  snapshot(params: { id: string }): Promise<TermSnapshotResult>
  on<E extends TermEventName>(event: E, cb: (data: Events[E]) => void): () => void
  onDisconnect(cb: () => void): () => void
}

export type TermEventName = 'term.data' | 'term.exit' | 'term.created' | 'term.killed'

export interface AppApi {
  homedir(): Promise<string>
  /** Shows a native folder picker; resolves to the chosen path or null. */
  openFolder(): Promise<string | null>
  /** True only when the app was launched with QUE_E2E=1. */
  e2e: boolean
}

/** Mirrors the daemon's project.* methods. */
export interface ProjectApi {
  add(params: ProjectAddParams): Promise<Project>
  list(): Promise<Project[]>
  remove(params: ProjectRemoveParams): Promise<{ ok: true }>
}

export type WorkspaceEventName =
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.removed'
  | 'workspace.status'

export type WorkspaceEvents = Pick<Events, WorkspaceEventName>

/** Mirrors the daemon's workspace.* methods and events. */
export interface WorkspaceApi {
  create(params: WorkspaceCreateParams): Promise<Workspace>
  list(params?: WorkspaceListParams): Promise<Workspace[]>
  get(params: { id: string }): Promise<Workspace>
  remove(params: WorkspaceRemoveParams): Promise<{ ok: true }>
  /** Opens a terminal in the worktree with the hooks wrapper on PATH. */
  openTerminal(params: WorkspaceOpenTerminalParams): Promise<{ id: string }>
  on<E extends WorkspaceEventName>(event: E, cb: (data: Events[E]) => void): () => void
}

export interface QueApi {
  term: TermApi
  project: ProjectApi
  workspace: WorkspaceApi
  app: AppApi
}

export interface QueTestHook {
  activeTermId(): string | null
  screenText(): string
}

declare global {
  interface Window {
    que: QueApi
    __que?: QueTestHook
  }
}
