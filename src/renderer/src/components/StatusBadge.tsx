import type { PullRequest, TaskState, WorkspaceStatus } from '../../../preload/index.d'
import { prBadge, statusBadge, taskBadge } from '../format'

/** A pull request as a chip link: `#41` by default, or the given label. */
export function PrChip({
  pr,
  testId,
  label
}: {
  pr: PullRequest
  testId?: string
  label?: string
}): React.JSX.Element {
  const badge = prBadge(pr)
  return (
    <a
      className={`status pr-chip tone-${badge.tone}`}
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      title={badge.title}
      data-testid={testId}
      data-pr-state={pr.state}
      data-pr-checks={pr.checks}
    >
      {label ?? badge.label}
    </a>
  )
}

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
