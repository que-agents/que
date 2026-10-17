import type { Task, Workspace } from '../../../preload/index.d'
import { type CountItem, countItemText } from '../../../shared/count-line'
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
import { QMarkIcon, UnlockIcon } from './icons'

interface Row {
  id: string
  name: string
  project: string
  /** The raw state (`needs_input`, `running`), for data-state. */
  state: string
  stateText: string
  dot: Tone
  /** Only stuck takes a tone on its word. */
  stuck: boolean
  lastActivity: string | null
}

/** `1.5` → `1.5`, `20` → `20`. */
function minutes(m: number): string {
  return String(Math.round(m * 100) / 100)
}

/** One count line item as spans: a toned or muted word, else faint. */
function CountSpan({ item }: { item: CountItem }): React.JSX.Element {
  const text = countItemText(item)

  if (!item.tone) return <span>{text}</span>

  return <span className={item.tone === 'muted' ? 'muted' : `tone-${item.tone}`}>{text}</span>
}

/**
 * Quiet hours: the one question, "running and not stuck?", answered from
 * across the room without pulling anyone in. A dim strip, one faint count
 * line, a dim row per live task and per workspace that is busy or has a live
 * terminal, and a ghost Unlock: no sentences, no badges, no links. Needs input
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
    name: w.name,
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

  return (
    <section className="quiet-board" data-testid="quiet-board" aria-label="Quiet hours">
      <span className="corner tl" aria-hidden="true" />
      <span className="corner tr" aria-hidden="true" />
      <span className="corner bl" aria-hidden="true" />
      <span className="corner br" aria-hidden="true" />
      <header className="quiet-board-strip" data-testid="quiet-board-header">
        <QMarkIcon />
        <span className="quiet-board-label">Quiet hours</span>{' '}
        <span className="quiet-board-clock">
          {hhmm(now)} <span className="quiet-board-until">· until {until}</span>
        </span>
      </header>
      <p className="count-line" data-testid="quiet-board-counts">
        {counts.length === 0
          ? NOTHING_RUNNING
          : counts.map((item, i) => (
              <span key={item.label}>
                {i > 0 ? ' · ' : ''}
                <CountSpan item={item} />
              </span>
            ))}
      </p>
      <div className="quiet-board-rows">
        {rows.length === 0 ? (
          <p className="quiet-board-empty" data-testid="quiet-board-empty">
            {boardEmptyLine({ queued: tally.queued, summaryAt })}
          </p>
        ) : (
          <ul aria-label="Running tonight">
            {rows.map((r) => (
              <li
                key={r.id}
                className={`dot-row tone-${r.dot}`}
                data-testid={`quiet-board-row-${r.id}`}
                data-state={r.state}
              >
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
      </footer>
    </section>
  )
}
