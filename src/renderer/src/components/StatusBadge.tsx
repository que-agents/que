import type { TaskState, WorkspaceStatus } from '../../../preload/index.d'
import { statusBadge, taskBadge } from '../format'

/** A workspace status as text and colour; `title` says why when stuck. */
export function StatusBadge({
  status,
  reason,
  testId
}: {
  status: WorkspaceStatus
  reason?: string | null
  testId?: string
}): React.JSX.Element {
  const { label, tone } = statusBadge(status)
  return (
    <span
      className={`status tone-${tone}`}
      data-testid={testId}
      data-status={status}
      title={reason ? `${label}: ${reason}` : label}
    >
      {label}
    </span>
  )
}

export function TaskBadge({
  state,
  testId
}: {
  state: TaskState
  testId?: string
}): React.JSX.Element {
  const { label, tone } = taskBadge(state)
  return (
    <span className={`status tone-${tone}`} data-testid={testId} data-status={state}>
      {label}
    </span>
  )
}
