import { useEffect, useState } from 'react'
import type { Task, Workspace } from '../../../preload/index.d'
import { formatAge, formatCost, formatDuration, hhmm } from '../../../shared/format'
import { ACTIVE_STATES } from '../../../shared/types'
import { isLiveTask, newestFirst } from '../format'
import { useQue, useStore } from '../store'

interface Row {
  id: string
  name: string
  project: string
  state: string
  stateText: string
  pr: string
  elapsedMs: number | null
  lastActivity: string | null
  turns: number | null
  costUsd: number | null
}

/** `1.5` → `1.5`, `20` → `20`. */
function minutes(m: number): string {
  return String(Math.round(m * 100) / 100)
}

/**
 * Quiet hours: the one question, "running and not stuck?". Counts and a row
 * per live task and per workspace with a live terminal; no terminal, no
 * output, no links. The only control is Unlock.
 */
export default function QuietBoard(): React.JSX.Element {
  const store = useStore()
  const { quiet, tasks, workspaces, projects, terminals, connected } = useQue()
  const [, tick] = useState(0)

  // Ages and elapsed times move on their own; events refresh everything else.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)

    return () => clearInterval(t)
  }, [])

  const now = store.now()
  const since = quiet?.windowStart ? Date.parse(quiet.windowStart) : now
  const projectName = (id: string): string => projects.find((p) => p.id === id)?.name ?? ''

  const tonight = Object.values(tasks).filter(
    (t) => isLiveTask(t.state) || Date.parse(t.updatedAt) >= since
  )

  const count = (pred: (t: Task) => boolean): number => tonight.filter(pred).length
  const paused = tonight.filter((t) => t.state === 'paused')

  const resets = paused
    .map((t) => t.pausedUntil)
    .filter((p): p is string => p !== null)
    .sort()[0]

  const ws = Object.values(workspaces)

  const wsCount = (status: Workspace['status']): number =>
    ws.filter((w) => w.status === status).length

  const live = newestFirst(Object.values(tasks).filter((t) => isLiveTask(t.state)))

  const taskRows: Row[] = live.map((t) => ({
    id: t.id,
    name: t.title,
    project: projectName(t.projectId),
    state: t.state,
    stateText: t.state,
    pr: '-',
    elapsedMs: t.startedAt ? now - Date.parse(t.startedAt) : null,
    lastActivity: t.lastActivityAt,
    turns: t.turns,
    costUsd: t.costUsd
  }))

  const workspaceRow = (w: Workspace): Row => {
    const terms = terminals.filter((t) => t.key === w.id && t.alive)

    return {
      id: w.id,
      name: w.name,
      project: projectName(w.projectId),
      state: w.status,
      stateText:
        w.status === 'needs_input'
          ? `needs input · since ${hhmm(Date.parse(w.statusAt))}`
          : w.status.replace('_', ' '),
      pr: w.pr ? `${w.pr.state}${w.pr.checks === 'failing' ? ' ✕' : ''}` : '-',
      elapsedMs:
        terms.length > 0 ? now - Math.min(...terms.map((t) => Date.parse(t.createdAt))) : null,
      lastActivity: w.lastActivityAt,
      turns: null,
      costUsd: null
    }
  }

  // Every workspace that is working, waiting or stuck, plus any with a live terminal.
  const shown = ws.filter(
    (w) =>
      ['working', 'needs_input', 'stuck'].includes(w.status) ||
      terminals.some((t) => t.key === w.id && t.alive)
  )

  const byStatus = (status: Workspace['status']): Row[] =>
    shown.filter((w) => w.status === status).map(workspaceRow)

  const rows: Row[] = [
    ...byStatus('needs_input'),
    ...byStatus('stuck'),
    ...taskRows,
    ...byStatus('working'),
    ...shown
      .filter((w) => !['needs_input', 'stuck', 'working'].includes(w.status))
      .map(workspaceRow)
  ]

  const unlockMinutes = quiet?.unlockMinutes ?? 20

  return (
    <section className="quiet-board" data-testid="quiet-board" aria-label="Quiet hours">
      <header className="quiet-board-header" data-testid="quiet-board-header">
        que · quiet hours · {hhmm(now)} · detail unlocks at{' '}
        {quiet?.windowEnd ? hhmm(Date.parse(quiet.windowEnd)) : '--:--'}
      </header>
      <div className="quiet-board-counts" data-testid="quiet-board-counts">
        <p>
          {count((t) => ACTIVE_STATES.has(t.state))} running · {paused.length} paused
          {resets ? ` (limit resets ${hhmm(Date.parse(resets))})` : ''} ·{' '}
          {count((t) => t.state === 'stuck')} stuck · {count((t) => t.state === 'done')} done
        </p>
        <p>
          {ws.length} {ws.length === 1 ? 'workspace' : 'workspaces'} · {wsCount('working')} working
          · {wsCount('needs_input')} need input · {wsCount('stuck')} stuck
        </p>
      </div>
      <div className="quiet-board-table">
        {rows.length === 0 ? (
          <p className="empty-note" data-testid="quiet-board-empty">
            Nothing running.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Project</th>
                <th scope="col">State</th>
                <th scope="col">PR</th>
                <th scope="col">Elapsed</th>
                <th scope="col">Last activity</th>
                <th scope="col">Turns</th>
                <th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`quiet-board-row-${r.id}`} data-state={r.state}>
                  <td className="name">{r.name}</td>
                  <td>{r.project}</td>
                  <td className={`state state-${r.state}`}>{r.stateText}</td>
                  <td className="state">{r.pr}</td>
                  <td>{r.elapsedMs === null ? '-' : formatDuration(r.elapsedMs)}</td>
                  <td>{formatAge(r.lastActivity, now, ' ago')}</td>
                  <td>{r.turns ?? '-'}</td>
                  <td>{r.costUsd === null ? '-' : formatCost(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <footer className="quiet-board-footer">
        <button
          type="button"
          data-testid="quiet-board-unlock"
          disabled={!connected}
          onClick={() => void store.unlock()}
        >
          Unlock {minutes(unlockMinutes)} min
        </button>
      </footer>
    </section>
  )
}
