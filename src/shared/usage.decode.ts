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

/** A window from its percent used and its reset in epoch ms; undefined when either is malformed. */
function usageWindow(pct: unknown, resetsAt: unknown): UsageWindow | undefined {
  const used = percent(pct)

  if (used === undefined || !isFiniteNumber(resetsAt) || resetsAt <= 0) return undefined

  return { pct: used, resetsAt }
}

/** A window as que keeps it (`pct`, `resetsAt` in epoch ms). */
const storedWindow = (v: unknown): UsageWindow | undefined =>
  isObj(v) ? usageWindow(v.pct, v.resetsAt) : undefined

/** A window as Claude Code sends it (`used_percentage`, `resets_at` in Unix seconds). */
const statusLineWindow = (v: unknown): UsageWindow | undefined =>
  isObj(v)
    ? usageWindow(
        v.used_percentage,
        isFiniteNumber(v.resets_at) ? Math.round(v.resets_at * 1000) : undefined
      )
    : undefined

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

/** A whole reading (usage.json, the usage.report params); null unless `at` is a time. */
export function decodeUsage(v: unknown): Usage | null {
  if (!isObj(v) || !isFiniteNumber(v.at)) return null
  const fiveHour = storedWindow(v.fiveHour)
  const sevenDay = storedWindow(v.sevenDay)
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

  const fields = fieldsOf(json)
  // The project's directory: `workspace.project_dir`, else `cwd`.
  const projectDir = str(fieldsOf(fields.workspace).project_dir) || str(fields.cwd) || undefined

  return { windows: decodeStatusLineUsage(json), projectDir }
}
