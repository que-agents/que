import { useCallback, useEffect, useRef, useState } from 'react'

export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 520
export const SIDEBAR_DEFAULT = 256
const STEP = 16
const STORAGE_KEY = 'que.sidebarWidth'

export function clampSidebarWidth(w: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)))
}

/** The remembered width, or the default when nothing sane is stored. */
export function loadSidebarWidth(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY))

    return Number.isFinite(n) && n > 0 ? clampSidebarWidth(n) : SIDEBAR_DEFAULT
  } catch {
    return SIDEBAR_DEFAULT
  }
}

/** The sidebar width as state, remembered across launches. */
export function useSidebarWidth(): [number, (w: number) => void] {
  const [width, setWidth] = useState(loadSidebarWidth)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width))
    } catch {
      // Nothing to remember into; the width still applies for this session.
    }
  }, [width])
  const set = useCallback((w: number) => setWidth(clampSidebarWidth(w)), [])

  return [width, set]
}

/**
 * The divider between the sidebar and the main area. Drag it to resize,
 * double-click it to go back to the default width, or focus it and use the
 * arrow keys (Home and End for the limits).
 */
export default function SidebarResizer({
  width,
  onChange
}: {
  width: number
  onChange: (width: number) => void
}): React.JSX.Element {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  const apply = (e: React.PointerEvent<HTMLHRElement>): void => {
    if (!drag.current) return
    onChange(drag.current.startWidth + e.clientX - drag.current.startX)
  }

  const end = (e: React.PointerEvent<HTMLHRElement>): void => {
    if (!drag.current) return
    drag.current = null

    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

    document.body.classList.remove('resizing')
  }

  return (
    <hr
      className="sidebar-resizer"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      data-testid="sidebar-resizer"
      title="Drag to resize; double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        drag.current = { startX: e.clientX, startWidth: width }
        e.currentTarget.setPointerCapture?.(e.pointerId)
        document.body.classList.add('resizing')
      }}
      onPointerMove={apply}
      onPointerUp={(e) => {
        // The last move can be coalesced away under load; the release point is final.
        apply(e)
        end(e)
      }}
      onPointerCancel={end}
      onDoubleClick={() => onChange(SIDEBAR_DEFAULT)}
      onKeyDown={(e) => {
        const next =
          e.key === 'ArrowLeft'
            ? width - STEP
            : e.key === 'ArrowRight'
              ? width + STEP
              : e.key === 'Home'
                ? SIDEBAR_MIN
                : e.key === 'End'
                  ? SIDEBAR_MAX
                  : null

        if (next === null) return
        e.preventDefault()
        onChange(next)
      }}
    />
  )
}
