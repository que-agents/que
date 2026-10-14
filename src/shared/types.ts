// Domain types shared by the daemon, CLI, and renderer. Placeholders until the
// workspace and task features land; shaped for what the tests need today.

export type WorkspaceStatus = 'working' | 'idle' | 'needs_input' | 'done' | 'stuck'

export interface Workspace {
  id: string
  projectId: string
  name: string
  branch: string
  path: string
  status: WorkspaceStatus
  createdAt: string
}

export type TaskState =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'paused'
  | 'finishing'
  | 'done'
  | 'stuck'
  | 'failed'

export interface Task {
  id: string
  workspaceId: string
  title: string
  state: TaskState
  prUrl?: string
  cost: number
  turns: number
  createdAt: string
}

/** Quiet window in local wall-clock time, `HH:MM`. */
export interface QuietWindow {
  start: string
  end: string
}

export interface QueConfig {
  quiet: QuietWindow & { overrides?: Partial<Record<string, QuietWindow>> }
  caps: { maxTurns: number; maxCostUsd: number }
  stallTimeoutMs: number
}
