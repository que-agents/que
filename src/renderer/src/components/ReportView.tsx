import { useCallback, useEffect, useState } from 'react'
import type { PullRequest, Report, WorkspaceDigest } from '../../../preload/index.d'
import { unlocksLine } from '../../../daemon/quiet-hours'
import { formatSince, hhmm } from '../../../shared/format'
import { formatDuration, nothingRanLine, reportCountItems } from '../../../daemon/report'
import { errorMessage } from '../../../shared/errors.decode'
import { statusBadge, type Tone } from '../format'
import { useQue, useStore } from '../store'
import CountLine from './CountLine'
import { RefreshIcon } from './icons'

/** A row's state word and the one tone it may take (none stays faint). */
interface StateWord {
  text: string
  tone: Tone | 'faint'
}

/** `#67 draft`, `#67 open · checks failing`. */
function prText(pr: PullRequest): string {
  return `#${pr.number} ${pr.state}${pr.checks === 'failing' ? ' · checks failing' : ''}`
}

/** `needs input · since 02:14` in attention, `stuck · no_heartbeat` in bad, else the status, muted. */
function workspaceState(d: WorkspaceDigest): StateWord {
  if (d.status === 'needs_input')
    return {
      text: d.waitingSince
        ? `needs input · since ${hhmm(Date.parse(d.waitingSince))}`
        : 'needs input',
      tone: 'attention'
    }

  if (d.status === 'stuck')
    return { text: d.statusReason ? `stuck · ${d.statusReason}` : 'stuck', tone: 'bad' }

  return { text: statusBadge(d.status).label, tone: 'muted' }
}

/** `worked 1h 12m · asked for input 2× · 3 ahead`. */
function workspaceFacts(d: WorkspaceDigest): string {
  return [
    d.workingMs > 0 ? `worked ${formatDuration(d.workingMs)}` : 'no work in this window',
    d.needsInputCount > 0 ? `asked for input ${d.needsInputCount}×` : null,
    d.commitsAhead !== null ? `${d.commitsAhead} ahead` : null
  ]
    .filter((f): f is string => f !== null)
    .join(' · ')
}

const stateClass = (tone: StateWord['tone']): string =>
  tone === 'faint'
    ? 'dot-row-state'
    : tone === 'muted'
      ? 'dot-row-state muted'
      : `dot-row-state tone-${tone}`

/** The pull request as a mono accent link, `#67 draft`; never its URL. */
function PrLink({
  href,
  text,
  testId
}: {
  href: string
  text: string
  testId: string
}): React.JSX.Element {
  return (
    <a className="report-pr" href={href} target="_blank" rel="noreferrer" data-testid={testId}>
      {text}
    </a>
  )
}

/**
 * The morning page: what the sessions did and what needs a look. One faint
 * count line, the unlocks line, then a dot row per workspace, in the quiet
 * board's language. Needs input keeps its tone here: the morning is when it
 * is acted on.
 */
export default function ReportView(): React.JSX.Element {
  const store = useStore()
  const { connected, workspaces } = useQue()
  const [report, setReport] = useState<Report | null>(null)
  const [unlocks, setUnlocks] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await store.fetchReport()
      const u = await store.fetchUnlocks(r.since)
      // Both at once, so the page never shows the count line without its unlocks line.
      setReport(r)
      setUnlocks(unlocksLine(u, store.now()))
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [store])

  // Refreshes when a workspace's status, reason or pull request changes, and
  // not on any other field: every load asks git for each workspace's commits ahead.
  const watched = Object.values(workspaces)
    .map((w) => [w.id, w.status, w.statusReason, w.pr?.state, w.pr?.checks].join(':'))
    .join(' ')

  useEffect(() => {
    void watched
    // oxlint-disable-next-line react/set-state-in-effect -- load awaits the daemon before it sets state, so nothing renders twice synchronously
    void load()
  }, [load, watched])

  const empty = report !== null && report.workspaces.length === 0

  return (
    <section
      className="report report-page"
      data-testid="report-view"
      aria-labelledby="report-title"
    >
      <header className="topbar">
        <h1 className="title" id="report-title">
          Report
        </h1>
        <span className="cwd" data-testid="report-since">
          {report ? formatSince(Date.parse(report.since), store.now()) : ''}
        </span>
        <div className="actions">
          <button
            type="button"
            className="ghost icon"
            aria-label="Refresh"
            title="Refresh"
            data-testid="report-refresh"
            disabled={!connected}
            onClick={() => void load()}
          >
            <RefreshIcon />
          </button>
        </div>
      </header>
      <div className="report-body">
        <div className="report-column">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="report-lines">
            {report && (
              <CountLine items={reportCountItems(report)} testId="report-totals">
                {empty ? (
                  <span data-testid="report-empty">{nothingRanLine(report, store.now())}</span>
                ) : (
                  nothingRanLine(report, store.now())
                )}
              </CountLine>
            )}
            {unlocks && (
              <p className="count-line" data-testid="report-unlocks">
                {unlocks}
              </p>
            )}
          </div>
          {report && report.workspaces.length > 0 && (
            <section data-testid="report-workspaces" aria-labelledby="rg-workspaces">
              <h2 id="rg-workspaces">
                Workspaces <span className="muted">{report.workspaces.length}</span>
              </h2>
              <ul>
                {report.workspaces.map((d) => {
                  const state = workspaceState(d)

                  return (
                    <li
                      key={d.id}
                      className={`dot-row tone-${statusBadge(d.status).tone}`}
                      data-testid={`report-workspace-${d.id}`}
                      data-state={d.status}
                    >
                      <span className="dot-row-dot" aria-hidden="true" />
                      <button
                        type="button"
                        className="dot-row-name report-name-link"
                        onClick={() => store.showTerminals(d.id)}
                      >
                        {d.name}
                      </button>
                      <span className="dot-row-project">{d.project}</span>
                      <span
                        className={stateClass(state.tone)}
                        data-testid={`report-workspace-${d.id}-status`}
                        data-status={d.status}
                      >
                        {state.text}
                      </span>
                      <span>
                        {d.pr && (
                          <PrLink
                            href={d.pr.url}
                            text={prText(d.pr)}
                            testId={`report-workspace-${d.id}-pr`}
                          />
                        )}
                      </span>
                      <span
                        className="dot-row-facts"
                        data-testid={`report-workspace-${d.id}-facts`}
                      >
                        {workspaceFacts(d)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </section>
  )
}
