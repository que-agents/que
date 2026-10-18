import { formatCountdown } from '../../../shared/format'
import { useQueSelector, useStore } from '../store'
import { useUnlockCountdown } from '../useUnlockCountdown'
import { UnlockIcon } from './icons'

/** An open lock, `unlocked · 14:32 left`, and Lock now, while an unlock runs. */
export default function UnlockStatus(): React.JSX.Element | null {
  const store = useStore()
  const connected = useQueSelector((s) => s.connected)
  const until = useUnlockCountdown()

  if (until === null) return null

  return (
    <div className="unlock-status" role="status">
      <UnlockIcon />
      <span data-testid="topbar-unlock-countdown">
        unlocked · {formatCountdown(until - store.now())} left
      </span>
      <button
        type="button"
        data-testid="topbar-lock"
        disabled={!connected}
        onClick={() => void store.lock()}
      >
        Lock now
      </button>
    </div>
  )
}
