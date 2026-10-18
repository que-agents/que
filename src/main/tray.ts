// The menu-bar item: a template icon titled with the workspace counts
// (`● working ▸ needs input ✕ stuck`; `● working ✕ stuck` while quiet hours are
// locked), recomputed from rows the daemon's events keep current, led by the
// unlock countdown while one runs. Clicking it
// brings the window forward (the quiet board during quiet hours).
import { Menu, nativeImage, Tray } from 'electron'
import { quietTrayTitle, summarize, traySummary } from '../daemon/status-engine'
import type { DaemonClient } from '../shared/client'
import type { Events } from '../shared/protocol'
import type { QuietState, StatusSummary } from '../shared/types'
import { applyTrayEvent, rowsFromLists, type TrayEventName, type TrayRows } from './tray-rows'

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
  /** Patches the rows with one daemon event and recomputes the title. */
  apply<E extends TrayEventName>(event: E, data: Events[E]): void
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
  let rows: TrayRows = rowsFromLists([], [])
  // Events that arrive while a list is in flight, replayed on top of it.
  let held: Array<(r: TrayRows) => TrayRows> | null = null

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

  const recount = (): void => {
    summary = traySummary([...rows.workspaces.values()], [...rows.tasks.values()])
    render()
  }

  const seed = (client: DaemonClient): void => {
    const mine: Array<(r: TrayRows) => TrayRows> = []
    held = mine
    void Promise.all([client.request('workspace.list'), client.request('task.list')])
      .then(([workspaces, tasks]) => {
        if (held !== mine) return
        rows = mine.reduce((r, patch) => patch(r), rowsFromLists(workspaces, tasks))
        held = null
        recount()
      })
      .catch(() => {
        // The daemon went away; the next connect seeds again.
        if (held === mine) held = null
      })
  }

  const apply = <E extends TrayEventName>(event: E, data: Events[E]): void => {
    const patch = (r: TrayRows): TrayRows => applyTrayEvent(r, event, data)

    if (held) {
      held.push(patch)

      return
    }

    rows = patch(rows)
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
    apply,
    setQuiet,
    destroy: () => {
      if (countdown) clearInterval(countdown)
      tray.destroy()
    }
  }
}
