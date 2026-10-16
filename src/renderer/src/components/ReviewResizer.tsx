import { useRef } from 'react'
import { REVIEW_DEFAULT, REVIEW_MAX, REVIEW_MIN } from '../store'

const STEP = 16

/**
 * The divider on the review pane's left edge. Drag it to resize (left widens),
 * double-click it to go back to the default width, or focus it and use the
 * arrow keys (Home and End for the limits).
 */
export default function ReviewResizer({
  width,
  onChange
}: {
  width: number
  onChange: (width: number) => void
}): React.JSX.Element {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  const apply = (e: React.PointerEvent<HTMLHRElement>): void => {
    if (!drag.current) return
    onChange(drag.current.startWidth - (e.clientX - drag.current.startX))
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
      className="review-resizer"
      aria-orientation="vertical"
      aria-label="Resize review"
      aria-valuemin={REVIEW_MIN}
      aria-valuemax={REVIEW_MAX}
      aria-valuenow={width}
      tabIndex={0}
      data-testid="review-resizer"
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
      onDoubleClick={() => onChange(REVIEW_DEFAULT)}
      onKeyDown={(e) => {
        const next =
          e.key === 'ArrowLeft'
            ? width + STEP
            : e.key === 'ArrowRight'
              ? width - STEP
              : e.key === 'Home'
                ? REVIEW_MIN
                : e.key === 'End'
                  ? REVIEW_MAX
                  : null

        if (next === null) return
        e.preventDefault()
        onChange(next)
      }}
    />
  )
}
