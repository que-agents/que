// Quiet hours in the daemon: the single source of truth for "is detail
// allowed right now". Tracks the window in progress (and the config it started
// under, for the apply-tonight guardrail), the manual window from `que quiet
// start` (used when no scheduled one covers the moment), the unlock, and its
// log; refuses the
// detail methods while quiet and locked; tells the server to drop every
// terminal subscription the moment that starts; emits quiet.changed and, once
// per window, quiet.morningSummary.
import type { Report } from '../shared/protocol'
import type {
  QuietHoursConfig,
  QuietKind,
  QuietState,
  QuietUnlock,
  UserConfig
} from '../shared/types'
import { hhmm } from '../shared/format'
import { badRequest, RpcError } from './errors'
import {
  type ActiveWindow,
  activeWindow,
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

/** A manual quiet's default and longest length, in minutes. */
const MANUAL_DEFAULT_MINUTES = 60
const MANUAL_MAX_MINUTES = 720

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
  private unlock: UnlockState & { id: number | null; kind: QuietKind } = {
    until: null,
    startedAt: null,
    id: null,
    kind: 'scheduled'
  }
  /** The manual window from `que quiet start`, while it is open. */
  private manual: { id: number; start: number; end: number } | null = null
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
    const manual = this.o.store.openManual()

    if (manual) {
      const until = Date.parse(manual.until)

      if (until > this.now()) {
        this.manual = { id: manual.id, start: Date.parse(manual.at), end: until }
      } else {
        this.o.store.endManual(manual.id, manual.until)
      }
    }

    const open = this.o.store.openUnlock()

    if (open) {
      const until = Date.parse(open.until)

      if (until > this.now()) {
        this.unlock = {
          id: open.id,
          until: new Date(until),
          startedAt: new Date(open.at),
          why: open.why ?? undefined,
          kind: open.kind
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

  /** The scheduled window when one covers `now`, else the manual one. */
  private window(now: number): ActiveWindow | null {
    return activeWindow(now, this.quietConfig(now), this.manual)
  }

  /** Quiet hours are on and no unlock is running: detail is refused. */
  locked(): boolean {
    const now = this.now()

    return this.window(now) !== null && !isUnlocked(now, this.unlock)
  }

  state(): QuietState {
    const now = this.now()
    const cfg = this.quietConfig(now)
    const w = activeWindow(now, cfg, this.manual)
    const scheduledNext = nextBoundary(now, cfg)

    // A manual window ends at its end, or sooner when a scheduled one starts.
    const next =
      w?.kind === 'manual' && (!scheduledNext || w.end.getTime() < scheduledNext.getTime())
        ? w.end
        : scheduledNext

    const unlocked = w !== null && isUnlocked(now, this.unlock)

    return {
      enabled: cfg.enabled,
      inQuietHours: w !== null,
      kind: w ? w.kind : null,
      windowStart: w ? w.start.toISOString() : null,
      windowEnd: w ? w.end.toISOString() : null,
      nextBoundary: next ? next.toISOString() : null,
      unlockedUntil: unlocked && this.unlock.until ? this.unlock.until.toISOString() : null,
      unlockMinutes: this.o.config().quietHours.unlockMinutes,
      locked: this.locked()
    }
  }

  /** Throws `quiet_hours` while quiet hours are on and locked. */
  check(): void {
    if (this.stopped) return
    const now = this.now()
    const w = this.window(now)

    if (!w || isUnlocked(now, this.unlock)) return
    throw new RpcError(
      'quiet_hours',
      quietMessage(w.end.getTime(), this.o.config().quietHours.unlockMinutes, w.kind)
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
    const w = this.window(now)

    if (!w) return this.state()
    this.endUnlock(now)
    const until = now + m * 60_000
    const reason = why?.trim() || null

    const id = this.o.store.insertUnlock({
      at: new Date(now).toISOString(),
      minutes: m,
      why: reason,
      until: new Date(until).toISOString(),
      kind: w.kind
    })

    this.unlock = {
      id,
      until: new Date(until),
      startedAt: new Date(now),
      why: reason ?? undefined,
      kind: w.kind
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

    this.unlock = { until: null, startedAt: null, id: null, kind: 'scheduled' }
  }

  // ---- manual quiet -------------------------------------------------------------

  /**
   * Opens a manual quiet window for `minutes` (default 60, at most 720), or
   * replaces the one running, ending any unlock. Inside quiet hours the state
   * comes back unchanged: the scheduled window already holds.
   */
  startManual(minutes?: number): QuietState {
    const now = this.now()
    const m = minutes ?? MANUAL_DEFAULT_MINUTES

    if (!Number.isFinite(m) || m <= 0 || m > MANUAL_MAX_MINUTES) {
      throw badRequest(`minutes must be more than 0 and at most ${MANUAL_MAX_MINUTES}`)
    }

    if (this.window(now)?.kind === 'scheduled') return this.state()
    this.endUnlock(now)

    if (this.manual) this.o.store.endManual(this.manual.id, new Date(now).toISOString())
    const end = now + m * 60_000

    const id = this.o.store.insertManual({
      at: new Date(now).toISOString(),
      until: new Date(end).toISOString()
    })

    this.manual = { id, start: now, end }
    this.o.log?.(`quiet: manual quiet for ${m} min until ${hhmm(end)}`)
    this.evaluate(true)

    return this.state()
  }

  /** Ends the manual quiet window and any unlock in it; without one, the state is unchanged. */
  endManual(): QuietState {
    if (!this.manual) return this.state()
    const now = this.now()
    this.endUnlock(now)
    this.closeManual(now)
    this.evaluate(true)

    return this.state()
  }

  private closeManual(at: number): void {
    if (!this.manual) return
    const end = Math.min(at, this.manual.end)
    this.o.store.endManual(this.manual.id, new Date(end).toISOString())
    this.manual = null
    this.o.log?.('quiet: manual quiet ended')
  }

  // ---- the clock ----------------------------------------------------------------

  /** Re-reads the clock: windows, unlock expiry, detaching, events, timers. */
  evaluate(force = false): void {
    if (this.stopped) return
    const now = this.now()
    const w = this.window(now)
    const scheduled = w?.kind === 'scheduled' ? w : null

    // A manual window ends at its end, or when quiet hours start inside it, so
    // it cannot come back when they end.
    if (this.manual && (now >= this.manual.end || scheduled)) this.closeManual(now)

    // Remember the config each scheduled window starts under, for the guardrail.
    if (
      scheduled &&
      (!this.held || this.held.start !== scheduled.start.getTime() || now >= this.held.end)
    ) {
      this.held = {
        cfg: this.quietConfig(now),
        start: scheduled.start.getTime(),
        end: scheduled.end.getTime()
      }
    } else if (!scheduled) {
      this.held = null
      this.applyTonightFor = null
    }

    // An unlock ends at its deadline, or with the window it was for.
    if (
      this.unlock.until &&
      (!w || w.kind !== this.unlock.kind || now >= this.unlock.until.getTime())
    ) {
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

    if (prev?.kind === 'scheduled' && !w && now >= prev.end.getTime() - 1_000) {
      void this.morningSummary(prev)
    }

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
