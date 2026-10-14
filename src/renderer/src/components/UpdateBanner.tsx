import { useEffect, useState } from 'react'
import type { UpdateInfo } from '../../../preload/index.d'
import { useStore } from '../store'

/** A quiet, dismissible line when a newer release exists; never a dialog. */
export default function UpdateBanner(): React.JSX.Element | null {
  const store = useStore()
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let live = true
    store.fetchUpdate().then(
      (found) => {
        if (live && found) setInfo(found)
      },
      () => {}
    )
    const off = store.onUpdate((found) => setInfo(found))
    return () => {
      live = false
      off()
    }
  }, [store])

  if (!info || dismissed) return null
  return (
    <div className="update-banner" role="status" data-testid="app-update-banner">
      <span>que {info.version} is available.</span>
      <button type="button" onClick={() => store.openUpdate()}>
        Download
      </button>
      <button
        type="button"
        className="ghost"
        aria-label="Dismiss update"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  )
}
