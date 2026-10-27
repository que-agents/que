// Claude plan usage in the daemon: the newest reading any session's status
// line reported (`que statusline` → usage.report). The numbers are
// account-wide, so the newest reading wins whole and an older one arriving
// late is ignored. A window is dropped once it resets, on a timer at the
// earliest reset; usage.changed goes out whenever what clients see changes.
// The reading is kept in usage.json so a restart shows it.
import fs from 'node:fs'
import { errorMessage } from '../shared/errors.decode'
import type { Usage, UsageWindow } from '../shared/types'
import { decodeUsage } from '../shared/usage.decode'
import { writeFileAtomic } from './atomic-write'
import type { Emit } from './bus'
import { MAX_TIMER_MS } from './quiet'

interface UsageServiceOptions {
  /** Where the reading is kept (paths.usageJson). */
  file: string
  emit: Emit
  log?: (msg: string) => void
  now?: () => number
}

/** The reading without the windows that have reset at `now`; null when none is left. */
function visibleUsage(u: Usage | null, now: number): Usage | null {
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

const sameWindow = (a?: UsageWindow, b?: UsageWindow): boolean =>
  a?.pct === b?.pct && a?.resetsAt === b?.resetsAt

/** The same windows and workspace; `at` is not compared. */
function sameReading(a: Usage | null, b: Usage | null): boolean {
  if (!a || !b) return a === b

  return (
    sameWindow(a.fiveHour, b.fiveHour) &&
    sameWindow(a.sevenDay, b.sevenDay) &&
    a.workspaceId === b.workspaceId
  )
}

export class UsageService {
  private readonly now: () => number
  /** The newest reading as reported, windows that have since reset included. */
  private current: Usage | null = null
  /** What usage.changed last announced (or what start found). */
  private lastEmitted: Usage | null = null
  private timer: NodeJS.Timeout | null = null
  /** The reset the timer is armed for. */
  private timerFor: number | null = null

  constructor(private o: UsageServiceOptions) {
    this.now = o.now ?? Date.now
  }

  /** Reads usage.json and arms the reset timer. */
  start(): void {
    this.current = this.load()
    this.lastEmitted = this.get()
    this.schedule()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.timerFor = null
  }

  get(): Usage | null {
    return visibleUsage(this.current, this.now())
  }

  /**
   * Takes a reading unless one at least as new is already held. usage.json is
   * written only when the windows or the workspace changed: a newer `at`
   * alone stays in memory, so a restart may show a slightly older time.
   */
  report(u: Usage): void {
    if (this.current && u.at <= this.current.at) return
    const changed = !sameReading(this.current, u)
    this.current = u

    if (changed) this.save(u)
    this.evaluate()
  }

  private evaluate(): void {
    const visible = this.get()

    if (!sameReading(visible, this.lastEmitted) || visible?.at !== this.lastEmitted?.at) {
      this.lastEmitted = visible
      this.o.emit('usage.changed', visible)
    }

    this.schedule()
  }

  /** One timer, at the earliest reset still ahead; left alone when that reset is unchanged. */
  private schedule(): void {
    const now = this.now()

    const resets = [this.current?.fiveHour?.resetsAt, this.current?.sevenDay?.resetsAt].filter(
      (t): t is number => t !== undefined && t > now
    )

    const next = resets.length > 0 ? Math.min(...resets) : null

    if (this.timer && next === this.timerFor) return
    this.stop()

    if (next === null) return
    this.timerFor = next

    this.timer = setTimeout(
      () => {
        this.timer = null
        this.evaluate()
      },
      Math.min(next - now + 5, MAX_TIMER_MS)
    )

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
    try {
      writeFileAtomic(this.o.file, `${JSON.stringify(u)}\n`, 0o600)
    } catch (err) {
      this.o.log?.(`usage: could not write ${this.o.file}: ${errorMessage(err)}`)
    }
  }
}
