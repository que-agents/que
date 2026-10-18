// The quiet-hours clock, as pure functions of an injected `now`: which window
// (if any) contains a moment, when the next start or end is, the unlock
// countdown, and the "apply tonight" guardrail. Windows are local wall-clock
// times; a window belongs to the weekday it starts on and may cross midnight.
// No Node imports: the renderer uses this module too.
import {
  type DayWindow,
  type QuietUnlock,
  type QuietHoursConfig,
  type QuietWindow,
  WEEKDAYS,
  type Weekday
} from '../shared/types'
import { hhmm } from '../shared/format'

export interface ActiveWindow {
  start: Date
  end: Date
  /** The weekday the window started on. */
  weekday: Weekday
}

export interface UnlockState {
  until: Date | null
  startedAt: Date | null
  why?: string
}

/** A point in time as epoch milliseconds (a Date converts with `getTime()`). */
type Moment = number

function minutesOf(hhmm: string): [number, number] {
  const [h, m] = hhmm.split(':').map(Number)

  return [h, m]
}

/** The window configured for the day a local date falls on, or null for none. */
export function windowForDay(day: Date, cfg: QuietHoursConfig): QuietWindow | null {
  if (!cfg.enabled) return null
  const override: DayWindow | undefined = cfg.days[WEEKDAYS[day.getDay()]]

  if (override === 'none') return null

  return override ?? cfg.default
}

/** The concrete window starting on the local calendar day of `day`, or null. */
function windowStartingOn(day: Date, cfg: QuietHoursConfig): ActiveWindow | null {
  const w = windowForDay(day, cfg)

  if (!w) return null
  const [sh, sm] = minutesOf(w.start)
  const [eh, em] = minutesOf(w.end)
  const y = day.getFullYear()
  const mo = day.getMonth()
  const d = day.getDate()
  // The Date constructor resolves local wall-clock times across DST changes.
  const start = new Date(y, mo, d, sh, sm)
  const crosses = eh * 60 + em <= sh * 60 + sm
  const end = new Date(y, mo, crosses ? d + 1 : d, eh, em)

  return { start, end, weekday: WEEKDAYS[day.getDay()] }
}

function addDays(t: number, days: number): Date {
  const d = new Date(t)

  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 12)
}

/** The window containing `now` (one that started yesterday or today), else null. */
export function currentWindow(now: Moment, cfg: QuietHoursConfig): ActiveWindow | null {
  const t = now

  for (const offset of [-1, 0]) {
    const w = windowStartingOn(addDays(t, offset), cfg)

    if (w && w.start.getTime() <= t && t < w.end.getTime()) return w
  }

  return null
}

export function isQuiet(now: Moment, cfg: QuietHoursConfig): boolean {
  return currentWindow(now, cfg) !== null
}

/** The next start or end after `now`: the current window's end, else the next start. */
export function nextBoundary(now: Moment, cfg: QuietHoursConfig): Date | null {
  const t = now
  const cur = currentWindow(t, cfg)

  if (cur) return cur.end

  for (let offset = 0; offset <= 8; offset++) {
    const w = windowStartingOn(addDays(t, offset), cfg)

    if (w && w.start.getTime() > t) return w.start
  }

  return null
}

/** Milliseconds left in an unlock; 0 when there is none or it has expired. */
export function remaining(now: Moment, state: UnlockState): number {
  if (!state.until) return 0

  return Math.max(0, state.until.getTime() - now)
}

export function isUnlocked(now: Moment, state: UnlockState): boolean {
  return remaining(now, state) > 0
}

/**
 * The "apply tonight" guardrail. `inForce` is the config the current window
 * started under; `incoming` is a new one. A change that would end the window
 * in progress sooner (or remove it) waits until tomorrow unless the user said
 * to apply it tonight; any other change applies at once.
 */
export function effectiveConfig(
  now: Moment,
  inForce: QuietHoursConfig,
  incoming: QuietHoursConfig,
  applyTonight: boolean
): QuietHoursConfig {
  if (applyTonight) return incoming
  const cur = currentWindow(now, inForce)

  if (!cur) return incoming
  const next = currentWindow(now, incoming)

  if (!next || next.end.getTime() < cur.end.getTime()) return inForce

  return incoming
}

/** True when `incoming` would end the window in progress under `current` sooner. */
export function shortensTonight(
  now: Moment,
  current: QuietHoursConfig,
  incoming: QuietHoursConfig
): boolean {
  return effectiveConfig(now, current, incoming, false) === current && current !== incoming
}

/** The one-line refusal every detail command gets during quiet hours. */
export function quietMessage(windowEnd: Moment, unlockMinutes: number): string {
  return `quiet hours until ${hhmm(windowEnd)}; run \`que unlock\` for ${unlockMinutes} minutes`
}

const TIMES = ['No unlocks', 'once', 'twice']

/** How long one unlock lasted: to its early lock, else its planned end, or now while it runs. */
function unlockedMs(u: QuietUnlock, now: Moment): number {
  const start = Date.parse(u.at)
  const planned = start + u.minutes * 60_000
  const end = u.endedAt ? Date.parse(u.endedAt) : Math.min(planned, now)

  return Math.max(0, end - start)
}

/** Whole minutes, `<1` for a moment that was not nothing. */
function minutesText(ms: number): string {
  const minutes = Math.round(ms / 60_000)

  return ms > 0 && minutes === 0 ? '<1' : String(minutes)
}

/** "Unlocked twice last night, 31 min total", or "No unlocks". */
export function formatUnlocks(unlocks: readonly QuietUnlock[], now: Moment): string {
  if (unlocks.length === 0) return 'No unlocks'
  let total = 0

  for (const u of unlocks) total += unlockedMs(u, now)

  const count = TIMES[unlocks.length] ?? `${unlocks.length} times`

  return `Unlocked ${count} last night, ${minutesText(total)} min total`
}

/**
 * The report's accountability line, `2 unlocks · 23:40 for 20 min · 01:12 for
 * 11 min`: each unlock's start and how long it lasted. Null when there were none.
 */
export function unlocksLine(unlocks: readonly QuietUnlock[], now: Moment): string | null {
  if (unlocks.length === 0) return null

  const each = unlocks.map(
    (u) => `${hhmm(Date.parse(u.at))} for ${minutesText(unlockedMs(u, now))} min`
  )

  return [`${unlocks.length} ${unlocks.length === 1 ? 'unlock' : 'unlocks'}`, ...each].join(' · ')
}
