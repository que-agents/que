// Quiet hours in the daemon: the single source of truth for "is detail
// allowed right now". Tracks the window in progress (and the config it started
// under, for the apply-tonight guardrail), the unlock, and its log; refuses the
// detail methods while quiet and locked; tells the server to drop every
// terminal subscription the moment that starts; emits quiet.changed and, once
// per window, quiet.morningSummary.
import { METHODS, type MethodName, type Report } from '../shared/protocol'
import type { QuietHoursConfig, QuietState, QuietUnlock, UserConfig } from '../shared/types'
import { badRequest, RpcError } from './errors'
import {
  type ActiveWindow,
  currentWindow,
  effectiveConfig,
  isUnlocked,
  nextBoundary,
  quietMessage,
  type UnlockState
} from './quiet-hours'
import type { Emit } from './bus'
import type { Store } from './store'
import { errorMessage } from '../shared/errors.decode'

/** setTimeout's ceiling; later boundaries are reached by the tick. */
const MAX_TIMER_MS = 2 ** 31 - 1

export interface QuietServiceOptions {
  store: Store
  emit: Emit
  config: () => UserConfig
  /** Every client's terminal subscriptions are dropped (they keep running). */
  detachAll: () => void
  /** The report since a time, for the morning summary. */
  report: (since: string) => Promise<Report>
  log?: (msg: string) => void
  now?: () => number
  /** Re-evaluation interval. Default 15 s. */
  tickMs?: number
}

interface HeldWindow {
  /** The quiet config the window started under. */
  cfg: QuietHoursConfig
  start: number
  end: number
}

export class QuietService {
  private readonly now: () => number
  private unlock: UnlockState & { id: number | null } = { until: null, startedAt: null, id: null }
  private held: HeldWindow | null = null
  /** The window whose start an apply-tonight change was made in. */
  private applyTonightFor: number | null = null
  private lastWindow: ActiveWindow | null = null
  private wasLocked = false
  private summarized = new Set<number>()
  private lastEmitted = ''
  private tickTimer: NodeJS.Timeout | null = null
  private boundaryTimer: NodeJS.Timeout | null = null
  private unlockTimer: NodeJS.Timeout | null = null
  private stopped = true

  constructor(private o: QuietServiceOptions) {
    this.now = o.now ?? Date.now
  }

  start(): void {
    this.stopped = false
    const open = this.o.store.openUnlock()

    if (open) {
      const until = Date.parse(open.until)

      if (until > this.now()) {
        this.unlock = {
          id: open.id,
          until: new Date(until),
          startedAt: new Date(open.at),
          why: open.why ?? undefined
        }
      } else {
        this.o.store.endUnlock(open.id, open.until)
      }
    }

    this.evaluate()
    this.tickTimer = setInterval(() => this.evaluate(), this.o.tickMs ?? 15_000)
    this.tickTimer.unref()
  }

  stop(): void {
    this.stopped = true

    for (const t of [this.tickTimer, this.boundaryTimer, this.unlockTimer]) {
      if (t) clearTimeout(t)
    }

    this.tickTimer = this.boundaryTimer = this.unlockTimer = null
  }

  // ---- config -----------------------------------------------------------------

  /** The quiet config in effect: the file's, unless the guardrail holds tonight's. */
  private quietConfig(now: number): QuietHoursConfig {
    const file = this.o.config().quietHours
    const held = this.held

    if (!held || now >= held.end || this.applyTonightFor === held.start) return file

    return effectiveConfig(now, held.cfg, file, false)
  }

  /** After config.set: with applyTonight, tonight's window follows the new file at once. */
  configChanged(applyTonight: boolean): void {
    if (applyTonight && this.held) this.applyTonightFor = this.held.start
    this.evaluate(true)
  }

  // ---- state --------------------------------------------------------------------

  private window(now: number): ActiveWindow | null {
    return currentWindow(now, this.quietConfig(now))
  }

  /** Quiet hours are on and no unlock is running: detail is refused. */
  locked(): boolean {
    const now = this.now()

    return this.window(now) !== null && !isUnlocked(now, this.unlock)
  }

  state(): QuietState {
    const now = this.now()
    const cfg = this.quietConfig(now)
    const w = currentWindow(now, cfg)
    const next = nextBoundary(now, cfg)
    const unlocked = w !== null && isUnlocked(now, this.unlock)

    return {
      enabled: cfg.enabled,
      inQuietHours: w !== null,
      windowStart: w ? w.start.toISOString() : null,
      windowEnd: w ? w.end.toISOString() : null,
      nextBoundary: next ? next.toISOString() : null,
      unlockedUntil: unlocked && this.unlock.until ? this.unlock.until.toISOString() : null,
      unlockMinutes: this.o.config().quietHours.unlockMinutes,
      locked: this.locked()
    }
  }

  /** Throws `quiet_hours` for a refused method while locked. */
  check(method: string): void {
    if (!isQuietRefused(method) || this.stopped) return
    const now = this.now()
    const w = this.window(now)

    if (!w || isUnlocked(now, this.unlock)) return
    throw new RpcError(
      'quiet_hours',
      quietMessage(w.end.getTime(), this.o.config().quietHours.unlockMinutes)
    )
  }

  // ---- unlock -------------------------------------------------------------------

  unlockFor(minutes?: number, why?: string): QuietState {
    const now = this.now()
    const m = minutes ?? this.o.config().quietHours.unlockMinutes

    if (!Number.isFinite(m) || m <= 0) {
      throw badRequest('minutes must be a positive number')
    }

    // Only meaningful during quiet hours; otherwise nothing is locked.
    if (!this.window(now)) return this.state()
    this.endUnlock(now)
    const until = now + m * 60_000
    const reason = why?.trim() || null

    const id = this.o.store.insertUnlock({
      at: new Date(now).toISOString(),
      minutes: m,
      why: reason,
      until: new Date(until).toISOString()
    })

    this.unlock = {
      id,
      until: new Date(until),
      startedAt: new Date(now),
      why: reason ?? undefined
    }
    this.o.log?.(`quiet: unlocked for ${m} min${reason ? ` (${reason})` : ''}`)
    this.evaluate(true)

    return this.state()
  }

  lock(): QuietState {
    const now = this.now()

    if (this.unlock.until) {
      this.endUnlock(now)
      this.o.log?.('quiet: locked early')
    }

    this.evaluate(true)

    return this.state()
  }

  log(since?: string): QuietUnlock[] {
    if (since !== undefined && Number.isNaN(Date.parse(since))) {
      throw badRequest('since must be an ISO time')
    }

    return this.o.store.listUnlocks(since ? new Date(Date.parse(since)).toISOString() : undefined)
  }

  private endUnlock(at: number): void {
    if (this.unlock.id !== null && this.unlock.until) {
      const end = Math.min(at, this.unlock.until.getTime())
      this.o.store.endUnlock(this.unlock.id, new Date(end).toISOString())
    }

    this.unlock = { until: null, startedAt: null, id: null }
  }

  // ---- the clock ----------------------------------------------------------------

  /** Re-reads the clock: windows, unlock expiry, detaching, events, timers. */
  evaluate(force = false): void {
    if (this.stopped) return
    const now = this.now()
    const w = this.window(now)

    // Remember the config each window starts under, for the guardrail.
    if (w && (!this.held || this.held.start !== w.start.getTime() || now >= this.held.end)) {
      this.held = { cfg: this.quietConfig(now), start: w.start.getTime(), end: w.end.getTime() }
    } else if (!w) {
      this.held = null
      this.applyTonightFor = null
    }

    // An unlock ends at its deadline, or with the quiet hours it was for.
    if (this.unlock.until && (!w || now >= this.unlock.until.getTime())) {
      this.o.log?.('quiet: unlock ended')
      this.endUnlock(now)
    }

    const locked = w !== null && !isUnlocked(now, this.unlock)

    if (locked && !this.wasLocked) {
      this.o.log?.('quiet: detail locked; detaching every terminal subscription')
      this.o.detachAll()
    }

    this.wasLocked = locked

    const prev = this.lastWindow
    this.lastWindow = w

    if (prev && !w && now >= prev.end.getTime() - 1_000) void this.morningSummary(prev)

    const state = this.state()
    const key = JSON.stringify(state)

    if (force || key !== this.lastEmitted) {
      this.lastEmitted = key
      this.o.emit('quiet.changed', state)
    }

    this.schedule(now, state)
  }

  private async morningSummary(window: ActiveWindow): Promise<void> {
    const start = window.start.getTime()

    if (!this.o.config().notifications.morningSummary || this.summarized.has(start)) return
    this.summarized.add(start)

    try {
      const report = await this.o.report(window.start.toISOString())
      this.o.emit('quiet.morningSummary', { report })
    } catch (err) {
      this.o.log?.(`quiet: morning summary failed: ${errorMessage(err)}`)
    }
  }

  private schedule(now: number, state: QuietState): void {
    if (this.boundaryTimer) clearTimeout(this.boundaryTimer)

    if (this.unlockTimer) clearTimeout(this.unlockTimer)
    this.boundaryTimer = this.unlockTimer = null

    const at = (iso: string | null, set: (t: NodeJS.Timeout) => void): void => {
      if (!iso) return
      const delay = Date.parse(iso) - now + 5

      if (delay > MAX_TIMER_MS) return
      const t = setTimeout(() => this.evaluate(), Math.max(0, delay))
      t.unref()
      set(t)
    }

    at(state.nextBoundary, (t) => {
      this.boundaryTimer = t
    })
    at(state.unlockedUntil, (t) => {
      this.unlockTimer = t
    })
  }
}

/** Whether quiet hours refuse this method; unknown names are not refused (the dispatcher rejects them). */
function isQuietRefused(method: string): boolean {
  return Object.hasOwn(METHODS, method) && METHODS[method as MethodName].quiet
}
