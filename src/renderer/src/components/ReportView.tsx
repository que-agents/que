import { useCallback, useEffect, useState } from 'react'
import type { PullRequest, Report, WorkspaceDigest } from '../../../preload/index.d'
import { formatUnlocks } from '../../../daemon/quiet-hours'
import { formatCost, formatDuration, REPORT_GROUPS } from '../format'
import { useQue, useStore } from '../store'
import { hhmm } from '../../../daemon/quiet-hours'
import { PrChip, StatusBadge, TaskBadge } from './StatusBadge'
import UnlockStatus from './UnlockStatus'

/** `worked 1h 12m · asked for input 2× · waiting since 02:14 · 3 commits ahead`. */
function digestFacts(d: WorkspaceDigest): string {
  const facts = [
    d.workingMs > 0 ? `worked ${formatDuration(d.workingMs)}` : 'no work in this window'
  ]
  if (d.needsInputCount > 0) facts.push(`asked for input ${d.needsInputCount}×`)
  if (d.waitingSince) facts.push(`waiting since ${hhmm(Date.parse(d.waitingSince))}`)
  if (d.commitsAhead !== null)
    facts.push(`${d.commitsAhead} ${d.commitsAhead === 1 ? 'commit' : 'commits'} ahead`)
  return facts.join(' · ')
}

/** What the overnight queue did since it was last opened, grouped by outcome. */
export default function ReportView(): React.JSX.Element {
  const store = useStore()
  const { connected, tasks, workspaces } = useQue()
  const [report, setReport] = useState<Report | null>(null)
  const [unlocks, setUnlocks] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const prOf = (id: string | null): PullRequest | null => (id && workspaces[id]?.pr) || null

  const load = useCallback(async () => {
    try {
      const r = await store.fetchReport()
      setReport(r)
      setUnlocks(formatUnlocks(await store.fetchUnlocks(r.since), store.now()))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [store])

  // Refreshes whenever a task's state, cost, turns or PR changes (the store's tasks).
  useEffect(() => {
    void tasks
    void load()
  }, [load, tasks])

  const groups = report ? REPORT_GROUPS.filter(({ group }) => report.groups[group].length > 0) : []

  return (
    <section className="report" data-testid="report-view" aria-labelledby="report-title">
      <header className="topbar">
        <h1 className="title" id="report-title">
          Report
        </h1>
        {report && (
          <span className="cwd muted">since {new Date(report.since).toLocaleString()}</span>
        )}
        <UnlockStatus />
        <div className="actions">
          <button
            type="button"
            data-testid="report-refresh"
            disabled={!connected}
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>
      </header>
      <div className="report-body">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {report && (
          <p className="totals" data-testid="report-totals">
            {report.totals.tasks} tasks · {report.totals.prs} PRs · {report.totals.turns} turns ·{' '}
            {formatCost(report.totals.costUsd)} · {formatDuration(report.totals.durationMs)}
            {report.totals.workspaces > 0 &&
              ` · ${report.totals.workspaces} workspaces · ${report.totals.needsInput} need input`}
          </p>
        )}
        {unlocks && (
          <p className="unlocks muted" data-testid="report-unlocks">
            {unlocks}
          </p>
        )}
        {report && groups.length === 0 && report.workspaces.length === 0 && (
          <p className="empty-note" data-testid="report-empty">
            Nothing ran in this window.
          </p>
        )}
        {report && report.workspaces.length > 0 && (
          <section data-testid="report-workspaces" aria-labelledby="rg-workspaces">
            <h2 id="rg-workspaces">
              Workspaces <span className="muted">{report.workspaces.length}</span>
            </h2>
            <ul>
              {report.workspaces.map((d) => (
                <li key={d.id} className="report-row" data-testid={`report-workspace-${d.id}`}>
                  <button
                    type="button"
                    className="link name"
                    onClick={() => store.showTerminals(d.id)}
                  >
                    {d.name}
                  </button>
                  <span className="muted">{d.project}</span>
                  <StatusBadge
                    status={d.status}
                    reason={d.statusReason}
                    testId={`report-workspace-${d.id}-status`}
                  />
                  <span className="facts muted" data-testid={`report-workspace-${d.id}-facts`}>
                    {digestFacts(d)}
                  </span>
                  {d.pr && <PrChip pr={d.pr} testId={`report-workspace-${d.id}-pr`} />}
                </li>
              ))}
            </ul>
          </section>
        )}
        {groups.map(({ group, title }) => (
          <section
            key={group}
            data-testid={`report-group-${group}`}
            aria-labelledby={`rg-${group}`}
          >
            <h2 id={`rg-${group}`}>
              {title} <span className="muted">{report?.groups[group].length}</span>
            </h2>
            <ul>
              {report?.groups[group].map((e) => (
                <li key={e.id} className="report-row" data-testid={`report-task-${e.id}`}>
                  <TaskBadge state={e.state} testId={`report-task-${e.id}-state`} />
                  <span className="name">{e.title}</span>
                  {e.state === 'stuck' && e.reason && (
                    <strong className="reason stuck" data-testid={`report-task-${e.id}-reason`}>
                      {e.reason}
                    </strong>
                  )}
                  <span className="muted">{e.workspace ?? ''}</span>
                  {e.state !== 'stuck' && e.reason && <span className="reason">{e.reason}</span>}
                  {prOf(e.workspaceId) && (
                    <PrChip
                      pr={prOf(e.workspaceId) as PullRequest}
                      label={prOf(e.workspaceId)?.state}
                      testId={`report-task-${e.id}-pr-state`}
                    />
                  )}
                  {e.prUrl && (
                    <a
                      href={e.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      data-testid={`report-task-${e.id}-pr`}
                    >
                      {e.prUrl}
                    </a>
                  )}
                  <span className="muted">
                    {e.durationMs !== null ? formatDuration(e.durationMs) : ''} · {e.turns} turns ·{' '}
                    {formatCost(e.costUsd)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
