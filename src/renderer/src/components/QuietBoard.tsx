import type { Workspace } from '../../../preload/index.d'
import { formatAge, hhmm } from '../../../shared/format'
import {
  boardCountItems,
  boardEmptyLine,
  boardTally,
  NOTHING_RUNNING
} from '../../../shared/quiet-board'
import { statusBadge, type Tone } from '../format'
import { useQue, useStore } from '../store'
import { useNow } from '../useNow'
import CountLine from './CountLine'
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

/**
 * Quiet hours (or a manual quiet): the one question, "running and not stuck?", answered from
 * across the room without pulling anyone in. A dim strip, one faint count
 * line, a dim row per workspace that is busy or has a live terminal, and a ghost Unlock (and End quiet in a manual window): no sentences, no badges, no links. Needs input
 * is not a night state here: it reads `waiting`, with no tone.
 */
export default function QuietBoard(): React.JSX.Element {
  const store = useStore()
  const { quiet, workspaces, projects, terminals, connected, config } = useQue()
  // Ages and elapsed times move on their own; events refresh everything else.
  const now = useNow()
  const windowEnd = quiet?.windowEnd ? Date.parse(quiet.windowEnd) : null
  const until = windowEnd === null ? '--:--' : hhmm(windowEnd)
  const projectName = (id: string): string => projects.find((p) => p.id === id)?.name ?? ''
  const ws = Object.values(workspaces)
  const hasTerminal = (w: Workspace): boolean => terminals.some((t) => t.key === w.id && t.alive)

  const counts = boardCountItems(
    boardTally({
      workspaces: ws.map((w) => ({ id: w.id, status: w.status, hasTerminal: hasTerminal(w) }))
    })
  )

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
            {boardEmptyLine({ summaryAt })}
          </p>
        ) : (
          <ul aria-label={manual ? 'Running' : 'Running tonight'}>
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
