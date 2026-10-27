// Claude plan usage in the daemon: the newest reading any session's status
// line reported (`que statusline` → usage.report). The numbers are
// account-wide, so the newest reading wins whole and an older one arriving
// late is ignored. A window is dropped once it resets, on a timer at the
// earliest reset; usage.changed goes out whenever what clients see changes.
// The reading is kept in usage.json so a restart shows it.
import fs from 'node:fs'
import { errorMessage } from '../shared/errors.decode'
import type { Usage } from '../shared/types'
import { decodeUsage } from '../shared/usage.decode'
import type { Emit } from './bus'

/** setTimeout's ceiling; a later reset is checked again when this timer fires. */
const MAX_TIMER_MS = 2 ** 31 - 1

export interface UsageServiceOptions {
  /** Where the reading is kept (paths.usageJson). */
  file: string
  emit: Emit
  log?: (msg: string) => void
  now?: () => number
}

/** The reading without the windows that have reset at `now`; null when none is left. */
export function visibleUsage(u: Usage | null, now: number): Usage | null {
  if (!u) return null
  const fiveHour = u.fiveHour && u.fiveHour.resetsAt > now ? u.fiveHour : undefined
  const sevenDay = u.sevenDay && u.sevenDay.resetsAt > now ? u.sevenDay : undefined

  if (!fiveHour && !sevenDay) return null

  return {
    ...(fiveHour && { fiveHour }),
    ...(sevenDay && { sevenDay }),
    at: u.at,
    ...(u.workspaceId && { workspaceId: u.workspaceId })
  }
}

export class UsageService {
  private readonly now: () => number
  /** The newest reading as reported, windows that have since reset included. */
  private current: Usage | null = null
  private lastEmitted = 'null'
  private timer: NodeJS.Timeout | null = null

  constructor(private o: UsageServiceOptions) {
    this.now = o.now ?? Date.now
  }

  /** Reads usage.json and arms the reset timer. */
  start(): void {
    this.current = this.load()
    this.lastEmitted = JSON.stringify(this.get())
    this.schedule()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  get(): Usage | null {
    return visibleUsage(this.current, this.now())
  }

  /** Takes a reading unless one at least as new is already held. */
  report(u: Usage): void {
    if (this.current && u.at <= this.current.at) return
    this.current = u
    this.save(u)
    this.evaluate()
  }

  private evaluate(): void {
    const key = JSON.stringify(this.get())

    if (key !== this.lastEmitted) {
      this.lastEmitted = key
      this.o.emit('usage.changed', this.get())
    }

    this.schedule()
  }

  /** One timer, at the earliest reset still ahead. */
  private schedule(): void {
    this.stop()
    const now = this.now()

    const resets = [this.current?.fiveHour?.resetsAt, this.current?.sevenDay?.resetsAt].filter(
      (t): t is number => t !== undefined && t > now
    )

    if (resets.length === 0) return
    const delay = Math.min(Math.min(...resets) - now + 5, MAX_TIMER_MS)
    this.timer = setTimeout(() => this.evaluate(), delay)
    this.timer.unref()
  }

  private load(): Usage | null {
    try {
      return decodeUsage(JSON.parse(fs.readFileSync(this.o.file, 'utf8')))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.o.log?.(`usage: could not read ${this.o.file}: ${errorMessage(err)}`)
      }

      return null
    }
  }

  private save(u: Usage): void {
    const tmp = `${this.o.file}.${process.pid}.tmp`

    try {
      fs.writeFileSync(tmp, `${JSON.stringify(u)}\n`, { mode: 0o600 })
      fs.renameSync(tmp, this.o.file)
    } catch (err) {
      this.o.log?.(`usage: could not write ${this.o.file}: ${errorMessage(err)}`)
    }
  }
}
