import { useState } from 'react'
import { daemonBannerText, restartCost } from '../daemon-banner'
import { useQueSelector, useStore } from '../store'

/**
 * A quiet line while the background service runs an older build than this app,
 * with a Restart button. Restarting ends every terminal, so it only ever
 * happens on the click.
 */
export default function DaemonBanner(): React.JSX.Element | null {
  const store = useStore()
  const stale = useQueSelector((s) => s.daemon?.stale ?? false)
  const terminals = useQueSelector((s) => s.terminals)
  const workspaces = useQueSelector((s) => s.workspaces)
  const [restarting, setRestarting] = useState(false)

  if (!stale) return null

  const restart = (): void => {
    setRestarting(true)
    void store.restartDaemon().then((ok) => {
      // On success the banner goes away with the stale state; on failure it can be tried again.
      if (!ok) setRestarting(false)
    })
  }

  return (
    <div className="update-banner" role="status" data-testid="app-daemon-banner">
      <span>{daemonBannerText(restartCost(terminals, workspaces))}</span>
      <button type="button" disabled={restarting} onClick={restart}>
        {restarting ? 'Restarting…' : 'Restart'}
      </button>
    </div>
  )
}
