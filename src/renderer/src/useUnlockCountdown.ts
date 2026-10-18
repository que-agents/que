import { useEffect, useState } from 'react'
import { useQueSelector } from './store'

/**
 * When the running unlock ends (ms since the epoch), or null when quiet hours are not
 * unlocked. Re-renders the caller every second while an unlock runs, so a countdown
 * read from it keeps time on its own.
 */
export function useUnlockCountdown(): number | null {
  const quiet = useQueSelector((s) => s.quiet)
  const until = quiet?.inQuietHours && quiet.unlockedUntil ? Date.parse(quiet.unlockedUntil) : null
  const [, tick] = useState(0)

  useEffect(() => {
    if (until === null) return
    const t = setInterval(() => tick((n) => n + 1), 1000)

    return () => clearInterval(t)
  }, [until])

  return until
}
