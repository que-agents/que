import { useCallback, useEffect, useState } from 'react'
import type { PullRequest, Report, ReportEntry, WorkspaceDigest } from '../../../preload/index.d'
import { unlocksLine } from '../../../daemon/quiet-hours'
import { formatCost, formatSince, hhmm } from '../../../shared/format'
import {
  formatDuration,
  nothingRanLine,
  REPORT_GROUPS,
  reportCountItems
} from '../../../daemon/report'
import { errorMessage } from '../../../shared/errors.decode'
import { prNumberOf, statusBadge, type Tone, taskBadge } from '../format'
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

/** `done` muted, a stuck or failed reason in bad, a paused `limit resets 03:00` in attention. */
function taskState(e: ReportEntry): StateWord {
  if (e.state === 'done') return { text: 'done', tone: 'muted' }

  if (e.state === 'stuck' || e.state === 'failed') return { text: e.reason ?? e.state, tone: 'bad' }

  if (e.state === 'paused')
    return {
      text: e.pausedUntil ? `limit resets ${hhmm(Date.parse(e.pausedUntil))}` : 'paused',
      tone: 'attention'
    }

  const label = taskBadge(e.state).label

  return { text: e.reason ? `${label} · ${e.reason}` : label, tone: 'faint' }
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
 * The morning page: what the night did, what needs a look, what it cost. One
 * faint count line, the unlocks line, then a dot row per task by outcome and
 * per workspace, in the quiet board's language. Needs input keeps its tone
 * here: the morning is when it is acted on.
 */
export default function ReportView(): React.JSX.Element {
  const store = useStore()
  const { connected, tasks, workspaces } = useQue()
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

  // Refreshes whenever a task's state, cost, turns or PR changes (the store's tasks).
  useEffect(() => {
    void tasks
    // oxlint-disable-next-line react/set-state-in-effect -- load awaits the daemon before it sets state, so nothing renders twice synchronously
    void load()
  }, [load, tasks])

  const groups = report ? REPORT_GROUPS.filter(({ group }) => report.groups[group].length > 0) : []
  const empty = report !== null && groups.length === 0 && report.workspaces.length === 0

  /** The task's link: the live pull request's number and state when known, else the URL's number. */
  const taskPr = (e: ReportEntry): { href: string; text: string } | null => {
    const live = (e.workspaceId && workspaces[e.workspaceId]?.pr) || null
    const href = e.prUrl ?? live?.url

    if (!href) return null

    return { href, text: live ? prText(live) : `#${prNumberOf(href)}` }
  }

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
          {report &&
            groups.map(({ group, title }) => (
              <section
                key={group}
                data-testid={`report-group-${group}`}
                aria-labelledby={`rg-${group}`}
              >
                <h2 id={`rg-${group}`}>
                  {title} <span className="muted">{report.groups[group].length}</span>
                </h2>
                <ul>
                  {report.groups[group].map((e) => {
                    const state = taskState(e)
                    const pr = taskPr(e)
                    const reason = (e.state === 'stuck' || e.state === 'failed') && e.reason

                    return (
                      <li
                        key={e.id}
                        className={`dot-row tone-${taskBadge(e.state).tone}`}
                        data-testid={`report-task-${e.id}`}
                        data-state={e.state}
                      >
                        <span className="dot-row-name" title={e.title}>
                          {e.title}
                        </span>
                        <span className="dot-row-project">{e.workspace ?? ''}</span>
                        <span
                          className={stateClass(state.tone)}
                          data-testid={`report-task-${e.id}-state`}
                          data-status={e.state}
                        >
                          {reason ? (
                            <span data-testid={`report-task-${e.id}-reason`}>{reason}</span>
                          ) : (
                            state.text
                          )}
                        </span>
                        <span>
                          {pr && (
                            <PrLink
                              href={pr.href}
                              text={pr.text}
                              testId={`report-task-${e.id}-pr`}
                            />
                          )}
                        </span>
                        <span className="dot-row-facts">
                          {formatDuration(e.durationMs)} · {e.turns} turns · {formatCost(e.costUsd)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
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
