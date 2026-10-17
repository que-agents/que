import { useEffect, useState } from 'react'
import { formatCountdown } from '../../../shared/format'
import { useQue, useStore } from '../store'

/** `🔓 unlocked · 14:32 left` and Lock now, while an unlock runs. */
export default function UnlockStatus(): React.JSX.Element | null {
  const store = useStore()
  const { quiet, connected } = useQue()
  const until = quiet?.inQuietHours && quiet.unlockedUntil ? Date.parse(quiet.unlockedUntil) : null
  const [, tick] = useState(0)

  useEffect(() => {
    if (until === null) return
    const t = setInterval(() => tick((n) => n + 1), 1000)

    return () => clearInterval(t)
  }, [until])

  if (until === null) return null

  return (
    <div className="unlock-status" role="status">
      <span data-testid="topbar-unlock-countdown">
        🔓 unlocked · {formatCountdown(until - store.now())} left
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
