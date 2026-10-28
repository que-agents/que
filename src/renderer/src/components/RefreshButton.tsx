import { useRef, useState } from 'react'
import { RefreshIcon } from './icons'

/**
 * A view's Refresh: a ghost icon button whose icon turns while its work runs. A click starts
 * the work unless it is still running; a failure is the caller's to keep and show, so the
 * button drops it. When the work ends the icon finishes the turn it is on and stops, so even
 * an instant refresh turns once and nothing snaps back mid-turn. Under reduced motion the icon
 * holds bright for the same beats instead (styles.css).
 */
export default function RefreshButton({
  onRefresh,
  testId,
  disabled
}: {
  onRefresh: () => Promise<void>
  testId: string
  disabled: boolean
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [turning, setTurning] = useState(false)
  // Read by the turn's end, which must see the work end even before the next render.
  const working = useRef(false)

  const refresh = async (): Promise<void> => {
    if (working.current) return
    working.current = true
    setBusy(true)
    setTurning(true)

    try {
      await onRefresh()
    } catch {
      // The store keeps the failure for the view; the button only stops turning.
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className="ghost icon"
      aria-label="Refresh"
      title="Refresh"
      aria-busy={busy}
      data-testid={testId}
      disabled={disabled}
      onClick={() => void refresh()}
    >
      <span
        className={turning ? 'refresh-turn turning' : 'refresh-turn'}
        data-testid={`${testId}-icon`}
        data-turning={turning}
        onAnimationIteration={() => {
          if (!working.current) setTurning(false)
        }}
      >
        <RefreshIcon />
      </span>
    </button>
  )
}
