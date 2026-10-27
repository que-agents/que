import { useState } from 'react'
import { useQueSelector, useStore } from '../store'

/**
 * A small control at the Quiet row's right end (after `lock now` during an unlock) while the background service runs an older
 * build than this app; absent otherwise. Its click updates the service in place
 * (see QueStore.upgradeDaemon), and on success it goes away with the stale state.
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
      title="que was updated. The background service still runs the previous build. Update it in place; every terminal keeps running."
      disabled={busy}
      onClick={update}
    >
      <span className="status-dot" aria-hidden="true" />
      {busy ? 'Updating…' : 'Update'}
    </button>
  )
}
