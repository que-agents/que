import { useState } from 'react'
import { DAEMON_UPDATE_TEXT, daemonRestartText, restartCost } from '../daemon-banner'
import { useQueSelector, useStore } from '../store'

/**
 * A quiet line while the background service runs an older build than this app.
 * Its button updates the service in place, which keeps every terminal running.
 * Only when that fails does it offer the restart, which ends them; both happen
 * only on a click.
 */
export default function DaemonBanner(): React.JSX.Element | null {
  const store = useStore()
  const stale = useQueSelector((s) => s.daemon?.stale ?? false)
  const build = useQueSelector((s) => s.daemon?.buildId ?? '')
  const terminals = useQueSelector((s) => s.terminals)
  const workspaces = useQueSelector((s) => s.workspaces)
  // Both belong to the daemon build they were for, so a later stale build starts afresh.
  const [busyFor, setBusyFor] = useState<string | null>(null)
  /** Why updating that build in place failed; set, the banner offers the restart instead. */
  const [refusal, setRefusal] = useState<{ build: string; reason: string } | null>(null)

  if (!stale) return null
  const busy = busyFor === build
  const refused = refusal?.build === build ? refusal.reason : null

  const update = (): void => {
    setBusyFor(build)
    void store.upgradeDaemon().then((r) => {
      // On success the banner goes away with the stale state.
      if (!r.ok) {
        setRefusal({ build, reason: r.reason })
        setBusyFor(null)
      }
    })
  }

  const restart = (): void => {
    setBusyFor(build)
    void store.restartDaemon().then((ok) => {
      // On success the banner goes away with the stale state; on failure it can be tried again.
      if (!ok) setBusyFor(null)
    })
  }

  if (refused === null) {
    return (
      <div className="update-banner" role="status" data-testid="app-daemon-banner">
        <span>{DAEMON_UPDATE_TEXT}</span>
        <button type="button" disabled={busy} onClick={update}>
          {busy ? 'Updating…' : 'Update'}
        </button>
      </div>
    )
  }

  return (
    <div className="update-banner" role="status" data-testid="app-daemon-banner">
      <span>{daemonRestartText(refused, restartCost(terminals, workspaces))}</span>
      <button type="button" disabled={busy} onClick={restart}>
        {busy ? 'Restarting…' : 'Restart'}
      </button>
    </div>
  )
}
