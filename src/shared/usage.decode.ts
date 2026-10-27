// Decodes Claude plan usage: the `rate_limits` Claude Code passes a status
// line command on stdin (`que statusline`), and the windows of a usage reading
// as they cross the socket or sit in usage.json. No Node imports: the
// renderer may use it too.
import { fieldsOf, isObj, str } from './json.decode'
import type { Usage, UsageWindow } from './types'

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Percent used, clamped to 0–100; undefined unless a finite number. */
function percent(v: unknown): number | undefined {
  return isFiniteNumber(v) ? Math.min(100, Math.max(0, v)) : undefined
}

/** A window as que keeps it (`pct`, `resetsAt` in epoch ms); undefined when malformed. */
export function decodeUsageWindow(v: unknown): UsageWindow | undefined {
  if (!isObj(v)) return undefined
  const pct = percent(v.pct)

  if (pct === undefined || !isFiniteNumber(v.resetsAt) || v.resetsAt <= 0) return undefined

  return { pct, resetsAt: v.resetsAt }
}

/** A window as Claude Code sends it (`used_percentage`, `resets_at` in Unix seconds). */
function statusLineWindow(v: unknown): UsageWindow | undefined {
  if (!isObj(v)) return undefined
  const pct = percent(v.used_percentage)
  const resetsAt = v.resets_at

  if (pct === undefined || !isFiniteNumber(resetsAt) || resetsAt <= 0) return undefined

  return { pct, resetsAt: Math.round(resetsAt * 1000) }
}

/**
 * The plan usage windows in a status line payload. Each is absent when Claude
 * Code left it out (no plan limits, no reply yet, reset) or sent it malformed.
 */
export function decodeStatusLineUsage(input: unknown): {
  fiveHour?: UsageWindow
  sevenDay?: UsageWindow
} {
  const limits = fieldsOf(fieldsOf(input).rate_limits)
  const fiveHour = statusLineWindow(limits.five_hour)
  const sevenDay = statusLineWindow(limits.seven_day)

  return { ...(fiveHour && { fiveHour }), ...(sevenDay && { sevenDay }) }
}

/** The directory a status line payload names for its project: `workspace.project_dir`, else `cwd`. */
export function statusLineProjectDir(input: unknown): string | undefined {
  const fields = fieldsOf(input)

  return str(fieldsOf(fields.workspace).project_dir) || str(fields.cwd) || undefined
}

/** A whole reading (usage.json, the usage.report params); null unless `at` is a time. */
export function decodeUsage(v: unknown): Usage | null {
  if (!isObj(v) || !isFiniteNumber(v.at)) return null
  const fiveHour = decodeUsageWindow(v.fiveHour)
  const sevenDay = decodeUsageWindow(v.sevenDay)
  const workspaceId = str(v.workspaceId)

  return {
    ...(fiveHour && { fiveHour }),
    ...(sevenDay && { sevenDay }),
    at: v.at,
    ...(workspaceId && { workspaceId })
  }
}

/** What `que statusline` reads from its stdin: the windows and the project directory. */
export interface StatusLineInput {
  windows: { fiveHour?: UsageWindow; sevenDay?: UsageWindow }
  projectDir?: string
}

/** Parses a status line's stdin; text that is not JSON has no windows and no directory. */
export function parseStatusLine(text: string): StatusLineInput {
  let json: unknown = null

  try {
    json = JSON.parse(text)
  } catch {
    // Claude Code sent something else: nothing to report, nowhere in particular.
  }

  return { windows: decodeStatusLineUsage(json), projectDir: statusLineProjectDir(json) }
}
