import { useCallback, useEffect, useState } from 'react'
import type { Report } from '../../../preload/index.d'
import { formatCost, formatDuration, REPORT_GROUPS } from '../format'
import { useQue, useStore } from '../store'
import { TaskBadge } from './StatusBadge'

/** What the overnight queue did since it was last opened, grouped by outcome. */
export default function ReportView(): React.JSX.Element {
  const store = useStore()
  const { connected } = useQue()
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setReport(await store.fetchReport())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [store])

  useEffect(() => {
    void load()
  }, [load])

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
          </p>
        )}
        {report && groups.length === 0 && (
          <p className="empty-note" data-testid="report-empty">
            Nothing ran in this window.
          </p>
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
                  <span className="muted">{e.workspace ?? ''}</span>
                  {e.reason && <span className="reason">{e.reason}</span>}
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
