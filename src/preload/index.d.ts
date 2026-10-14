import type {
  Events,
  TermAttachResult,
  TermCreateParams,
  TermInfo,
  TermSnapshotResult
} from '../shared/protocol'

export type { Events, TermAttachResult, TermCreateParams, TermInfo, TermSnapshotResult }

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
