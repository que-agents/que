// The menu-bar item: a template icon titled with the workspace counts
// (`● working ▸ needs input ✕ stuck`), recomputed from the daemon on every
// status change, led by the unlock countdown while one runs. Clicking it
// brings the window forward (the quiet board during quiet hours).
import { Menu, nativeImage, Tray } from 'electron'
import { quietTrayTitle, summarize, traySummary } from '../daemon/status-engine'
import type { DaemonClient } from '../shared/client'
import type { QuietState, StatusSummary } from '../shared/types'

/** A 32×32 (16pt @2x) monochrome "q": a ring with a descender, as raw BGRA. */
function iconBitmap(): Buffer {
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  const cx = 14.5
  const cy = 13.5
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy)
      const ring = d <= 10 && d >= 6.5
      const stem = x >= 21 && x <= 24 && y >= 13 && y <= 29
      if (ring || stem) buf.writeUInt32LE(0xff000000, (y * size + x) * 4)
    }
  }
  return buf
}

export interface QueTray {
  title(): string
  /** Recomputes the title from the daemon; overlapping calls coalesce. */
  refresh(client: DaemonClient): void
  /** The daemon's quiet state changed. */
  setQuiet(q: QuietState | null): void
  destroy(): void
}

export interface TrayOptions {
  show: () => void
  quit: () => void
  unlock: () => void
  lock: () => void
}

export function createTray(opts: TrayOptions): QueTray {
  const image = nativeImage.createFromBitmap(iconBitmap(), {
    width: 32,
    height: 32,
    scaleFactor: 2
  })
  image.setTemplateImage(true)
  const tray = new Tray(image)
  let summary: StatusSummary = summarize([])
  let quiet: QuietState | null = null
  let countdown: NodeJS.Timeout | null = null
  let title = quietTrayTitle(summary, quiet, Date.now())
  let running = false
  let again: DaemonClient | null = null

  const menu = (): Menu =>
    Menu.buildFromTemplate([
      { label: 'Open que', click: opts.show },
      { type: 'separator' },
      { label: `Working: ${summary.working}`, enabled: false },
      { label: `Needs input: ${summary.needs_input}`, enabled: false },
      { label: `Stuck: ${summary.stuck}`, enabled: false },
      ...(quiet?.inQuietHours
        ? ([
            { type: 'separator' },
            quiet.unlockedUntil
              ? { label: 'Lock now', click: opts.lock }
              : { label: `Unlock ${quiet.unlockMinutes} min`, click: opts.unlock }
          ] as Electron.MenuItemConstructorOptions[])
        : []),
      { type: 'separator' },
      { label: 'Quit que', click: opts.quit }
    ])
  const render = (): void => {
    title = quietTrayTitle(summary, quiet, Date.now())
    if (tray.isDestroyed()) return
    tray.setTitle(title)
    tray.setToolTip(quiet?.inQuietHours ? 'que · quiet hours' : 'que')
  }
  // Left click brings the window forward; right click shows the menu (a
  // context menu set with setContextMenu would swallow the left click).
  tray.on('click', opts.show)
  tray.on('right-click', () => tray.popUpContextMenu(menu()))
  render()

  const refresh = (client: DaemonClient): void => {
    if (running) {
      again = client
      return
    }
    running = true
    void Promise.all([client.request('workspace.list'), client.request('task.list')])
      .then(([workspaces, tasks]) => {
        summary = traySummary(workspaces, tasks)
        render()
      })
      .catch(() => {
        // The daemon went away; the next status event retries.
      })
      .finally(() => {
        running = false
        const next = again
        again = null
        if (next) refresh(next)
      })
  }

  const setQuiet = (q: QuietState | null): void => {
    quiet = q
    const ticking = Boolean(q?.inQuietHours && q.unlockedUntil)
    if (ticking && !countdown) {
      countdown = setInterval(render, 1000)
      countdown.unref()
    } else if (!ticking && countdown) {
      clearInterval(countdown)
      countdown = null
    }
    render()
  }

  return {
    title: () => title,
    refresh,
    setQuiet,
    destroy: () => {
      if (countdown) clearInterval(countdown)
      tray.destroy()
    }
  }
}
