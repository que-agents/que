import { useCallback, useEffect, useRef, useState } from 'react'
import { formatWeekdayClock, hhmm } from '../../../shared/format'
import type { Usage, UsageWindow } from '../../../shared/types'
import { formatUntil, formatUntilShort, usagePercent, usageTone } from '../../../shared/usage'
import { useQueSelector } from '../store'
import { useNow } from '../useNow'
import { useDismiss } from '../useDismiss'
import { useFloatingPlace } from '../useFloatingPlace'

/** Just right of the sidebar, its bottom edge level with the sidebar's (the strip's). */
const PLACEMENT = { gap: 4, align: 'bottom' } as const

const BUTTON_ID = 'sidebar-usage'
const CARD_ID = 'sidebar-usage-card'

const NO_READING_TIP =
  "Claude usage fills in after a session's first reply, on plans with usage limits"

interface WindowSpec {
  key: 'fiveHour' | 'sevenDay'
  id: string
  /** On the strip. */
  short: string
  /** In the card and the accessible name. */
  long: string
  /** The card's right end: when the window resets. */
  resets: (w: UsageWindow, now: number) => string
}

/** The two windows, in the order they read. */
const WINDOWS: readonly WindowSpec[] = [
  {
    key: 'fiveHour',
    id: 'five-hour',
    short: '5h',
    long: '5-hour',
    resets: (w, now) => `resets ${hhmm(w.resetsAt)} · ${formatUntil(w.resetsAt, now)}`
  },
  {
    key: 'sevenDay',
    id: 'weekly',
    short: 'wk',
    long: 'weekly',
    resets: (w) => `resets ${formatWeekdayClock(w.resetsAt)}`
  }
]

/** `Claude usage: 5-hour 42%, weekly 18%`; a window without a reading says so. */
function accessibleName(u: Usage | null): string {
  if (!u) return 'Claude usage: no reading yet'

  const parts = WINDOWS.map(({ key, long }) => {
    const w = u[key]

    return `${long} ${w ? `${usagePercent(w)}%` : 'no reading'}`
  })

  return `Claude usage: ${parts.join(', ')}`
}

/** ` · 38m`: the time until a full window resets. Only this part of the button ticks. */
function Until({ id, resetsAt }: { id: string; resetsAt: number }): React.JSX.Element {
  const now = useNow()

  return (
    <span className="usage-until" data-testid={`${BUTTON_ID}-${id}-until`}>
      {' · '}
      {formatUntilShort(resetsAt, now)}
    </span>
  )
}

/**
 * The card beside the sidebar, its bottom level with the foot's strip: `[ CLAUDE USAGE ]`, a
 * line and a meter per window, a hairline, and when the reading was taken and where. Closes
 * on Escape or a press outside it and the button (the button's own click toggles it).
 */
function UsageCard({
  usage,
  sidebar,
  button,
  onClose
}: {
  usage: Usage
  sidebar: React.RefObject<HTMLElement | null>
  button: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}): React.JSX.Element {
  // The time until the five-hour reset reads in minutes; useNow keeps it current.
  const now = useNow()
  const ref = useRef<HTMLElement>(null)

  const workspace = useQueSelector((s) =>
    usage.workspaceId ? s.workspaces[usage.workspaceId] : undefined
  )

  const place = useFloatingPlace(ref, sidebar, PLACEMENT, [usage, workspace])
  useDismiss(onClose, ref, button)

  return (
    <section
      ref={ref}
      className="floating-card usage-card"
      aria-label="Claude usage"
      data-testid={CARD_ID}
      style={place ?? undefined}
    >
      <span className="label">Claude usage</span>
      {WINDOWS.map((spec) => {
        const w = usage[spec.key]
        const tone = (w && usageTone(w)) ?? undefined
        const pct = w ? usagePercent(w) : 0

        return (
          <div key={spec.id} className="usage-window" data-testid={`${CARD_ID}-${spec.id}`}>
            <span className="usage-window-name">{spec.long}</span>
            <span
              className="usage-window-pct"
              data-testid={`${CARD_ID}-${spec.id}-percent`}
              data-tone={tone}
            >
              {w ? `${pct}%` : '—'}
            </span>
            <span className="usage-window-resets" data-testid={`${CARD_ID}-${spec.id}-resets`}>
              {w && spec.resets(w, now)}
            </span>
            <span className="usage-meter" aria-hidden="true">
              <span
                className="usage-meter-fill"
                data-testid={`${CARD_ID}-${spec.id}-meter`}
                data-tone={tone}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </span>
          </div>
        )
      })}
      <hr />
      <div className="usage-as-of" data-testid={`${CARD_ID}-as-of`}>
        as of {hhmm(usage.at)}
        {workspace && (
          <>
            {' · '}
            <span className="usage-workspace">{workspace.title ?? workspace.name}</span>
          </>
        )}
      </div>
    </section>
  )
}

/**
 * The right end of the sidebar foot's strip: the five-hour and weekly Claude plan usage
 * (`5h 42%  wk 18%`), each number in its tone at 80% and 100%, and at 100% the time until that
 * window resets. `5h —  wk —` before a reading. A click opens the card with the reset times,
 * placed beside `sidebar`.
 */
export default function UsageFoot({
  sidebar
}: {
  sidebar: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const usage = useQueSelector((s) => s.usage)
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const close = useCallback((): void => setOpen(false), [])
  const hasReading = usage !== null

  // A dropped reading closes the card, so the next one does not open it again unasked.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the reading comes from the store, outside this component's events
    if (!hasReading) setOpen(false)
  }, [hasReading])

  const shown = open && hasReading

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`usage-button${usage ? '' : ' no-reading'}`}
        data-testid={BUTTON_ID}
        aria-label={accessibleName(usage)}
        title={usage ? 'Claude usage' : NO_READING_TIP}
        aria-expanded={usage ? shown : undefined}
        onClick={() => usage && setOpen((o) => !o)}
      >
        {WINDOWS.map((spec) => {
          const w = usage?.[spec.key]
          const tone = (w && usageTone(w)) ?? undefined

          return (
            <span key={spec.id}>
              <span className="usage-label">{spec.short}</span>{' '}
              <span className="usage-num" data-testid={`${BUTTON_ID}-${spec.id}`} data-tone={tone}>
                {w ? `${usagePercent(w)}%` : '—'}
              </span>
              {w && tone === 'bad' && <Until id={spec.id} resetsAt={w.resetsAt} />}
            </span>
          )
        })}
      </button>
      {shown && <UsageCard usage={usage} sidebar={sidebar} button={button} onClose={close} />}
    </>
  )
}
