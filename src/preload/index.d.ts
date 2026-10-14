import type {
  Events,
  TermAttachResult,
  TermCreateParams,
  TermInfo,
  TermSnapshotResult
} from '../shared/protocol'
import type { Task, Workspace, WorkspaceStatus } from '../shared/types'

export type {
  Events,
  Task,
  TermAttachResult,
  TermCreateParams,
  TermInfo,
  TermSnapshotResult,
  Workspace,
  WorkspaceStatus
}

/** Mirrors the daemon's term.* protocol methods and events. */
export interface TermApi {
  create(params: TermCreateParams): Promise<{ id: string }>
  list(): Promise<TermInfo[]>
  attach(params: { id: string; cols: number; rows: number }): Promise<TermAttachResult>
  detach(params: { id: string }): Promise<{ ok: true }>
  write(params: { id: string; data: string }): void
  resize(params: { id: string; cols: number; rows: number }): Promise<{ ok: true }>
  kill(params: { id: string }): Promise<{ ok: true }>
  snapshot(params: { id: string }): Promise<TermSnapshotResult>
  on<E extends keyof Events>(event: E, cb: (data: Events[E]) => void): () => void
  onDisconnect(cb: () => void): () => void
}

export interface AppApi {
  homedir(): Promise<string>
  /** Shows a native folder picker; resolves to the chosen path or null. */
  openFolder(): Promise<string | null>
  /** True only when the app was launched with QUE_E2E=1. */
  e2e: boolean
}

export interface WorkspaceEvents {
  'workspace.status': { id: string; status: WorkspaceStatus }
}

/**
 * The workspace surface the renderer will get once the daemon owns
 * workspaces. Not exposed by the preload yet; the fake bridge implements it
 * so renderer tests can be written against it.
 */
export interface WorkspaceApi {
  list(): Promise<Workspace[]>
  get(params: { id: string }): Promise<Workspace>
  on<E extends keyof WorkspaceEvents>(event: E, cb: (data: WorkspaceEvents[E]) => void): () => void
}

export interface QueApi {
  term: TermApi
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
