// Claude plan usage as text: how long until a window resets (`in 2h 10m`),
// when (`16:20`, `Mon 09:00`), and the lines `que usage` prints. Shared by the
// CLI and the app. Local time, no Node imports.
import { formatDuration, formatWeekdayClock, hhmm } from './format'
import type { Usage, UsageWindow } from './types'

/** `in 2h 10m`, `in 45m`, `in 3d 4h`; `in <1m` under a minute, `now` once it has passed. */
export function formatUntil(t: number, now: number): string {
  const ms = t - now

  if (ms <= 0) return 'now'

  if (ms < 60_000) return 'in <1m'
  const hours = Math.floor(ms / 3_600_000)

  if (hours < 24) return `in ${formatDuration(ms, { seconds: false, pad: false })}`

  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** A percentage used, as a whole number. */
export function usagePercent(w: UsageWindow): number {
  return Math.round(w.pct)
}

/** `5h  42%`: a window's label and its percentage, right-aligned to `100%`. */
function head(label: string, w: UsageWindow): string {
  return `${label} ${String(usagePercent(w)).padStart(3)}%`
}

/**
 * What `que usage` prints: the five-hour window with its reset clock and the
 * time until it, the weekly one with its reset weekday and clock, then when
 * the reading was taken and the workspace that took it. `no reading yet`
 * without one.
 */
export function formatUsage(u: Usage | null, now: number, workspaceName?: string): string[] {
  if (!u) return ['no reading yet']
  const lines: string[] = []

  if (u.fiveHour) {
    const { resetsAt } = u.fiveHour
    lines.push(
      `${head('5h', u.fiveHour)}  resets ${hhmm(resetsAt)} (${formatUntil(resetsAt, now)})`
    )
  }

  if (u.sevenDay) {
    lines.push(`${head('wk', u.sevenDay)}  resets ${formatWeekdayClock(u.sevenDay.resetsAt)}`)
  }

  lines.push(workspaceName ? `as of ${hhmm(u.at)} · ${workspaceName}` : `as of ${hhmm(u.at)}`)

  return lines
}
