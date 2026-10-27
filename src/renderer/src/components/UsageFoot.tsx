import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatWeekdayClock, hhmm } from '../../../shared/format'
import type { Usage, UsageWindow } from '../../../shared/types'
import { formatUntil, formatUntilShort, usagePercent, usageTone } from '../../../shared/usage'
import { useQueSelector } from '../store'
import { useNow } from '../useNow'
import { useDismiss } from '../useDismiss'

/** The card's distance from the sidebar's right edge. */
const GAP = 4

const NO_READING_TIP =
  "Claude usage fills in after a session's first reply, on plans with usage limits"

/** The two windows, in the order they read: the short label on the strip, the long one in the card. */
const WINDOWS = [
  { key: 'fiveHour', id: 'five-hour', short: '5h', long: '5-hour' },
  { key: 'sevenDay', id: 'weekly', short: 'wk', long: 'weekly' }
] as const

type WindowSpec = (typeof WINDOWS)[number]

/** `toned tone-attention` for a window at 80% and over, `toned tone-bad` at 100%; nothing below. */
function toneClass(w: UsageWindow | undefined): string {
  const tone = w ? usageTone(w) : null

  return tone ? ` toned tone-${tone}` : ''
}

/** `Claude usage: 5-hour 42%, weekly 18%`; a window without a reading says so. */
function accessibleName(u: Usage | null): string {
  if (!u) return 'Claude usage: no reading yet'

  const parts = WINDOWS.map(({ key, long }) => {
    const w = u[key]

    return `${long} ${w ? `${usagePercent(w)}%` : 'no reading'}`
  })

  return `Claude usage: ${parts.join(', ')}`
}

/** `resets 16:20 · in 2h 10m` for the five-hour window, `resets Mon 09:00` for the weekly one. */
function resetsText(spec: WindowSpec, w: UsageWindow, now: number): string {
  return spec.key === 'fiveHour'
    ? `resets ${hhmm(w.resetsAt)} · ${formatUntil(w.resetsAt, now)}`
    : `resets ${formatWeekdayClock(w.resetsAt)}`
}

/**
 * The card beside the sidebar, its bottom level with the foot's strip: `[ CLAUDE USAGE ]`, a
 * line and a meter per window, a hairline, and when the reading was taken and where. Closes
 * on Escape or a press outside it and the button (the button's own click toggles it).
 */
function UsageCard({
  usage,
  button,
  onClose
}: {
  usage: Usage
  button: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}): React.JSX.Element {
  // The time until the five-hour reset reads in minutes; useNow keeps it current.
  const now = useNow()
  const ref = useRef<HTMLElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)

  const workspace = useQueSelector((s) =>
    usage.workspaceId ? s.workspaces[usage.workspaceId] : undefined
  )

  useDismiss(onClose, ref, button)

  // Placed before paint: just right of the sidebar, its bottom edge level with the strip's.
  useLayoutEffect(() => {
    const el = button.current
    const sidebar = el?.closest('aside')?.getBoundingClientRect()
    const strip = el?.closest('.foot-strip')?.getBoundingClientRect()

    if (!sidebar || !strip) return
    const height = ref.current?.offsetHeight ?? 0
    setPlace({ left: sidebar.right + GAP, top: strip.bottom - height })
  }, [button, usage, workspace])

  const id = 'sidebar-usage-card'

  return (
    <section
      ref={ref}
      className="usage-card"
      aria-label="Claude usage"
      data-testid={id}
      style={place ?? undefined}
    >
      <span className="label">Claude usage</span>
      {WINDOWS.map((spec) => {
        const w = usage[spec.key]
        const pct = w ? usagePercent(w) : 0

        return (
          <div key={spec.id} className="usage-window" data-testid={`${id}-${spec.id}`}>
            <span className="usage-window-name">{spec.long}</span>
            <span
              className={`usage-window-pct${toneClass(w)}`}
              data-testid={`${id}-${spec.id}-percent`}
              data-tone={(w && usageTone(w)) ?? undefined}
            >
              {w ? `${pct}%` : '—'}
            </span>
            <span className="usage-window-resets" data-testid={`${id}-${spec.id}-resets`}>
              {w && resetsText(spec, w, now)}
            </span>
            <span className="usage-meter" aria-hidden="true">
              <span
                className={`usage-meter-fill${toneClass(w)}`}
                data-testid={`${id}-${spec.id}-meter`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </span>
          </div>
        )
      })}
      <hr />
      <div className="usage-as-of" data-testid={`${id}-as-of`}>
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
 * window resets. `5h —  wk —` before a reading. A click opens the card with the reset times.
 */
export default function UsageFoot(): React.JSX.Element {
  const usage = useQueSelector((s) => s.usage)
  // At 100% a window reads the time until it resets, in minutes.
  const now = useNow()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const close = useCallback((): void => setOpen(false), [])

  // A dropped reading closes the card, so the next one does not open it again unasked.
  if (open && !usage) setOpen(false)
  const shown = open && usage !== null

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`usage-button${usage ? '' : ' empty'}`}
        data-testid="sidebar-usage"
        aria-label={accessibleName(usage)}
        title={usage ? 'Claude usage' : NO_READING_TIP}
        aria-expanded={usage ? shown : undefined}
        onClick={() => usage && setOpen((o) => !o)}
      >
        {WINDOWS.map((spec) => {
          const w = usage?.[spec.key]

          return (
            <span key={spec.id} className="usage-pair">
              <span className="usage-label">{spec.short}</span>{' '}
              <span
                className={`usage-num${toneClass(w)}`}
                data-testid={`sidebar-usage-${spec.id}`}
                data-tone={(w && usageTone(w)) ?? undefined}
              >
                {w ? `${usagePercent(w)}%` : '—'}
              </span>
              {w && usageTone(w) === 'bad' && (
                <span className="usage-until" data-testid={`sidebar-usage-${spec.id}-until`}>
                  {' · '}
                  {formatUntilShort(w.resetsAt, now)}
                </span>
              )}
            </span>
          )
        })}
      </button>
      {/* In the body: the foot is sticky, a layer of its own the main area would draw over. */}
      {shown &&
        createPortal(<UsageCard usage={usage} button={button} onClose={close} />, document.body)}
    </>
  )
}
