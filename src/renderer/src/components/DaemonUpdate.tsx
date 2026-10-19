import { useState } from 'react'
import { DAEMON_UPDATE_TITLE } from '../daemon-update'
import { useQueSelector, useStore } from '../store'

/**
 * A small control beside Settings while the background service runs an older
 * build than this app; absent otherwise. Its click updates the service in place,
 * which keeps every terminal running, and on success it goes away with the stale
 * state. A refusal goes to the error line and the control stays, for another try
 * after a rebuild. Nothing here ends a terminal.
 */
export default function DaemonUpdate(): React.JSX.Element | null {
  const store = useStore()
  const stale = useQueSelector((s) => s.daemon?.stale ?? false)
  const [busy, setBusy] = useState(false)

  if (!stale) return null

  const update = (): void => {
    setBusy(true)
    void store.upgradeDaemon().finally(() => setBusy(false))
  }

  return (
    <button
      type="button"
      className="update-chip"
      data-testid="sidebar-daemon-update"
      title={DAEMON_UPDATE_TITLE}
      disabled={busy}
      onClick={update}
    >
      <span className="dot" aria-hidden="true" />
      {busy ? 'Updating…' : 'Update'}
    </button>
  )
}
