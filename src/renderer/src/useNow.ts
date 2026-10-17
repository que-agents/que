import { useEffect, useState } from 'react'
import { useStore } from './store'

/** The shortest interval useNow ticks at: ages read in minutes, so twice a minute is enough. */
export const NOW_MIN_INTERVAL_MS = 30_000

/**
 * The store's clock, read again every `intervalMs` (at least 30 s), so a component that shows an
 * age ("2m ago") or an elapsed time keeps it fresh on its own rather than when something else
 * happens to re-render it. The timer stops on unmount.
 */
export function useNow(intervalMs = NOW_MIN_INTERVAL_MS): number {
  const store = useStore()
  const [, tick] = useState(0)
  const every = Math.max(intervalMs, NOW_MIN_INTERVAL_MS)

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), every)

    return () => clearInterval(t)
  }, [every])

  return store.now()
}
