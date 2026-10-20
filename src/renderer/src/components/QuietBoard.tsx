import type { Task, Workspace } from '../../../preload/index.d'
import { formatAge, formatDuration, hhmm } from '../../../shared/format'
import {
  boardCountItems,
  boardEmptyLine,
  boardTally,
  NOTHING_RUNNING
} from '../../../shared/quiet-board'
import { ACTIVE_STATES } from '../../../shared/types'
import { isLiveTask, newestFirst, statusBadge, type Tone, taskBadge } from '../format'
import { useQue, useStore } from '../store'
import { useNow } from '../useNow'
import CountLine from './CountLine'
import { QMarkIcon, UnlockIcon } from './icons'
import WorkingMark from './WorkingMark'

interface Row {
  id: string
  name: string
  project: string
  /** The raw state (`needs_input`, `running`), for data-state. */
  state: string
  stateText: string
  /** The dot's tone; `busy` draws the working mark instead of a dot. */
  dot: Tone
  /** Only stuck takes a tone on its word. */
  stuck: boolean
  lastActivity: string | null
}

/** `1.5` → `1.5`, `20` → `20`. */
function minutes(m: number): string {
  return String(Math.round(m * 100) / 100)
}

/**
 * Quiet hours (or a manual quiet): the one question, "running and not stuck?", answered from
 * across the room without pulling anyone in. A dim strip, one faint count
 * line, a dim row per live task and per workspace that is busy or has a live
 * terminal, and a ghost Unlock (and End quiet in a manual window): no sentences, no badges, no links.
 * A working row draws the sidebar's working mark, so "still happening" reads the same. Needs input
 * is not a night state here: it reads `waiting`, with no tone.
 */
export default function QuietBoard(): React.JSX.Element {
  const store = useStore()
  const { quiet, tasks, workspaces, projects, terminals, connected, config } = useQue()
  // Ages and elapsed times move on their own; events refresh everything else.
  const now = useNow()
  const since = quiet?.windowStart ? Date.parse(quiet.windowStart) : now
  const windowEnd = quiet?.windowEnd ? Date.parse(quiet.windowEnd) : null
  const until = windowEnd === null ? '--:--' : hhmm(windowEnd)
  const projectName = (id: string): string => projects.find((p) => p.id === id)?.name ?? ''
  const ws = Object.values(workspaces)
  const hasTerminal = (w: Workspace): boolean => terminals.some((t) => t.key === w.id && t.alive)

  const tally = boardTally({
    tasks: Object.values(tasks),
    workspaces: ws.map((w) => ({ id: w.id, status: w.status, hasTerminal: hasTerminal(w) })),
    sinceMs: since
  })

  const counts = boardCountItems(tally)

  // Queued tasks are not running yet: the empty line counts them instead.
  const live = newestFirst(
    Object.values(tasks).filter((t) => isLiveTask(t.state) && t.state !== 'queued')
  )

  const taskRow = (t: Task): Row => ({
    id: t.id,
    name: t.title,
    project: projectName(t.projectId),
    state: t.state,
    stateText:
      ACTIVE_STATES.has(t.state) && t.startedAt
        ? `${t.state} · ${formatDuration(now - Date.parse(t.startedAt), { seconds: false })}`
        : t.state,
    dot: taskBadge(t.state).tone,
    stuck: false,
    lastActivity: t.lastActivityAt
  })

  const workspaceRow = (w: Workspace): Row => ({
    id: w.id,
    name: w.title ?? w.name,
    project: projectName(w.projectId),
    state: w.status,
    stateText: w.status === 'needs_input' ? 'waiting' : statusBadge(w.status).label,
    dot: w.status === 'needs_input' ? 'neutral' : statusBadge(w.status).tone,
    stuck: w.status === 'stuck',
    lastActivity: w.lastActivityAt
  })

  // Every workspace that is working, waiting or stuck, plus any with a live terminal.
  const shown = ws.filter(
    (w) => ['working', 'needs_input', 'stuck'].includes(w.status) || hasTerminal(w)
  )

  const byStatus = (status: Workspace['status']): Row[] =>
    shown.filter((w) => w.status === status).map(workspaceRow)

  const rows: Row[] = [
    ...byStatus('stuck'),
    ...live.map(taskRow),
    ...byStatus('working'),
    ...byStatus('needs_input'),
    ...shown
      .filter((w) => !['stuck', 'working', 'needs_input'].includes(w.status))
      .map(workspaceRow)
  ]

  const summaryAt = config?.config.notifications.morningSummary ? windowEnd : null
  const unlockMinutes = quiet?.unlockMinutes ?? 20
  // A manual quiet (`que quiet start`) is not tonight: the same board, plainer words.
  const manual = quiet?.kind === 'manual'
  const label = manual ? 'Quiet' : 'Quiet hours'

  return (
    <section className="quiet-board" data-testid="quiet-board" aria-label={label}>
      <span className="corner tl" aria-hidden="true" />
      <span className="corner tr" aria-hidden="true" />
      <span className="corner bl" aria-hidden="true" />
      <span className="corner br" aria-hidden="true" />
      <header className="quiet-board-strip" data-testid="quiet-board-header">
        <QMarkIcon />
        <span className="quiet-board-label">{label}</span>{' '}
        <span className="quiet-board-clock">
          {hhmm(now)} <span className="quiet-board-until">· until {until}</span>
        </span>
      </header>
      <CountLine items={counts} testId="quiet-board-counts">
        {NOTHING_RUNNING}
      </CountLine>
      <div className="quiet-board-rows">
        {rows.length === 0 ? (
          <p className="quiet-board-empty" data-testid="quiet-board-empty">
            {boardEmptyLine({ queued: tally.queued, summaryAt, kind: quiet?.kind })}
          </p>
        ) : (
          <ul aria-label={manual ? 'Running' : 'Running tonight'}>
            {rows.map((r) => (
              <li
                key={r.id}
                className={`dot-row tone-${r.dot}${r.dot === 'busy' ? ' working' : ''}`}
                data-testid={`quiet-board-row-${r.id}`}
                data-state={r.state}
              >
                {r.dot === 'busy' && <WorkingMark data-testid={`quiet-board-mark-${r.id}`} />}
                <span className="dot-row-name">{r.name}</span>{' '}
                <span className="dot-row-project">{r.project}</span>{' '}
                <span className={r.stuck ? 'dot-row-state tone-bad' : 'dot-row-state'}>
                  {r.stateText}
                </span>{' '}
                <span className="dot-row-age">{formatAge(r.lastActivity, now, ' ago')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="quiet-board-footer">
        <button
          type="button"
          className="ghost"
          data-testid="quiet-board-unlock"
          disabled={!connected}
          onClick={() => void store.unlock()}
        >
          <UnlockIcon />
          Unlock {minutes(unlockMinutes)} min
        </button>
        {manual && (
          <button
            type="button"
            className="ghost"
            data-testid="quiet-board-end"
            disabled={!connected}
            onClick={() => void store.endQuiet()}
          >
            End quiet
          </button>
        )}
      </footer>
    </section>
  )
}
