// The menu-bar item: a template icon titled with the workspace counts
// (`● working ▸ needs input ✕ stuck`; `● working ✕ stuck` while quiet hours are
// locked), recomputed from rows the daemon's events keep current, led by the
// unlock countdown while one runs. Clicking it
// brings the window forward (the quiet board during quiet hours).
import { Menu, nativeImage, Tray } from 'electron'
import { quietTrayTitle, summarize } from '../daemon/status-engine'
import type { DaemonClient } from '../shared/client'
import type { QuietState, StatusSummary, Workspace } from '../shared/types'

/** The tray tooltip and board window title in a quiet window, else null. */
export function quietTitle(q: QuietState | null): string | null {
  if (!q?.inQuietHours) return null

  return q.kind === 'manual' ? 'que · quiet' : 'que · quiet hours'
}

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
  /** Lists the daemon's rows afresh (on connect and reconnect); events that arrive meanwhile apply on top. */
  seed(client: DaemonClient): void
  /** A workspace was created or updated. */
  putWorkspace(w: Workspace): void
  /** A workspace was removed. */
  dropWorkspace(id: string): void
  /** The daemon's quiet state changed. */
  setQuiet(q: QuietState | null): void
  destroy(): void
}

export interface TrayOptions {
  show: () => void
  quit: () => void
  unlock: () => void
  lock: () => void
  /** Starts a manual quiet window of `minutes`. */
  start: (minutes: number) => void
  /** Ends a manual quiet window. */
  end: () => void
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
  const workspaces = new Map<string, Workspace>()
  // Changes that arrive while the list is in flight, replayed on top of them.
  let held: Array<() => void> | null = null

  // In a window: End quiet (a manual one only) over Unlock or Lock now.
  // Outside one: the three ways to go quiet now.
  const quietItems = (): Electron.MenuItemConstructorOptions[] => {
    if (!quiet?.inQuietHours) {
      return [
        { label: 'Quiet for 30 min', click: () => opts.start(30) },
        { label: 'Quiet for 1 hour', click: () => opts.start(60) },
        { label: 'Quiet for 2 hours', click: () => opts.start(120) }
      ]
    }

    return [
      ...(quiet.kind === 'manual' ? [{ label: 'End quiet', click: opts.end }] : []),
      quiet.unlockedUntil
        ? { label: 'Lock now', click: opts.lock }
        : { label: `Unlock ${quiet.unlockMinutes} min`, click: opts.unlock }
    ]
  }

  const menu = (): Menu =>
    Menu.buildFromTemplate([
      { label: 'Open que', click: opts.show },
      { type: 'separator' },
      { label: `Working: ${summary.working}`, enabled: false },
      { label: `Needs input: ${summary.needs_input}`, enabled: false },
      { label: `Stuck: ${summary.stuck}`, enabled: false },
      { type: 'separator' },
      ...quietItems(),
      { type: 'separator' },
      { label: 'Quit que', click: opts.quit }
    ])

  const render = (): void => {
    title = quietTrayTitle(summary, quiet, Date.now())

    if (tray.isDestroyed()) return
    tray.setTitle(title)
    tray.setToolTip(quietTitle(quiet) ?? 'que')
  }

  // Left click brings the window forward; right click shows the menu (a
  // context menu set with setContextMenu would swallow the left click).
  tray.on('click', opts.show)
  tray.on('right-click', () => tray.popUpContextMenu(menu()))
  render()

  const recount = (): void => {
    summary = summarize([...workspaces.values()])
    render()
  }

  const seed = (client: DaemonClient): void => {
    const mine: Array<() => void> = []
    held = mine
    void client
      .request('workspace.list')
      .then((wsList) => {
        if (held !== mine) return
        held = null
        workspaces.clear()

        for (const w of wsList) workspaces.set(w.id, w)

        for (const replay of mine) replay()

        recount()
      })
      .catch(() => {
        // The daemon went away; the next connect seeds again.
        if (held === mine) held = null
      })
  }

  // Applies a change now, or holds it for the seed to replay while the list is in flight.
  const change = (fn: () => void): void => {
    if (held) {
      held.push(fn)

      return
    }

    fn()
    recount()
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
    seed,
    putWorkspace: (w) => change(() => workspaces.set(w.id, w)),
    dropWorkspace: (id) => change(() => workspaces.delete(id)),
    setQuiet,
    destroy: () => {
      if (countdown) clearInterval(countdown)
      tray.destroy()
    }
  }
}
