import { type DependencyList, type RefObject, useLayoutEffect, useState } from 'react'

/** The least room kept between a floating card and the window's top and bottom edges. */
const MARGIN = 8

export interface FloatingPlace {
  left: number
  top: number
}

export interface Placement {
  /** The card's distance from the anchor's right edge. */
  gap: number
  /** `top`: the card hangs from the anchor's top; `bottom`: its bottom is level with the anchor's. */
  align: 'top' | 'bottom'
  /** How far a hanging card's top sits above the anchor's. */
  rise?: number
}

/**
 * Where a `.floating-card` goes beside `anchor`, measured before paint and again when `deps`
 * change. A hanging card is lifted until it fits the window; no card goes above its top margin.
 */
export function useFloatingPlace(
  card: RefObject<HTMLElement | null>,
  anchor: RefObject<HTMLElement | null>,
  { gap, align, rise = 0 }: Placement,
  deps: DependencyList
): FloatingPlace | null {
  const [place, setPlace] = useState<FloatingPlace | null>(null)

  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect()

    if (!r) return
    const height = card.current?.offsetHeight ?? 0

    const top =
      align === 'top'
        ? Math.min(r.top - rise, window.innerHeight - height - MARGIN)
        : r.bottom - height

    // oxlint-disable-next-line react/set-state-in-effect -- the place is measured from the DOM, which exists only after render
    setPlace({ left: r.right + gap, top: Math.max(MARGIN, top) })
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the caller's deps name what moves the card; the rest is read from the DOM
  }, [card, anchor, gap, align, rise, ...deps])

  return place
}
