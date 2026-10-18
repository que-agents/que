// The one table of config key names: the camelCase names a UserConfig and a
// ConfigPatch use, against the snake_case keys of the config file. Both
// directions read it (a patch to the file's table, a `que config set` key to a
// patch). No Node imports, so the renderer's fake bridge can use it.
import { isTable } from './config-patch.decode'
import { type ConfigPatch, type JsonValue, WEEKDAYS } from './types'

/** A table of the config file, as the merge reads it. */
type TomlTable = Record<string, JsonValue>

/** Top-level settings: patch name to file key. */
const TOP_KEYS: Record<string, string> = {
  worktreeRoot: 'worktree_root',
  stallTimeoutMinutes: 'stall_timeout_minutes',
  statusPollSeconds: 'status_poll_seconds',
  prPollSeconds: 'pr_poll_seconds',
  concurrency: 'concurrency',
  maxTurns: 'max_turns',
  maxBudgetUsd: 'max_budget_usd',
  defaultPermissionMode: 'default_permission_mode',
  allowBypassPermissions: 'allow_bypass_permissions',
  protectedBranches: 'protected_branches',
  instructionsFile: 'instructions_file',
  startPrompt: 'start_prompt',
  summaries: 'summaries',
  summaryModel: 'summary_model',
  summaryIntervalMinutes: 'summary_interval_minutes'
}

interface Section {
  /** The section's table name in the file. */
  table: string
  /** Its plain settings: patch name to file key. */
  keys: Record<string, string>
}

/** The fixed sections. Each also has keys of its own kind, handled where they are read. */
const SECTIONS: Record<string, Section> = {
  quietHours: {
    table: 'quiet_hours',
    keys: { enabled: 'enabled', default: 'default', unlockMinutes: 'unlock_minutes' }
  },
  notifications: {
    table: 'notifications',
    keys: {
      chimeOnComplete: 'chime_on_complete',
      chimeOnNeedsInput: 'chime_on_needs_input',
      morningSummary: 'morning_summary'
    }
  },
  jira: {
    table: 'jira',
    keys: { jql: 'jql', pollMinutes: 'poll_minutes', site: 'site', startPrompt: 'start_prompt' }
  }
}

/** A configured repo's settings: patch name to file key. */
const REPO_KEYS: Record<string, string> = { path: 'path', defaultBranch: 'default_branch' }

const WEEKDAY_NAMES: readonly string[] = WEEKDAYS

const has = (table: Record<string, unknown>, key: string): boolean => Object.hasOwn(table, key)

/** The key whose value is `value`, or undefined. */
function keyOf(table: Record<string, string>, value: string): string | undefined {
  return Object.keys(table).find((k) => table[k] === value)
}

function unknownKey(key: string): Error {
  return new Error(`unknown config key ${JSON.stringify(key)}`)
}

/** `{ start, end }` as the file's `["start", "end"]`; anything else is left for validation to refuse. */
function windowToToml(v: unknown): JsonValue {
  if (isTable(v) && typeof v.start === 'string' && typeof v.end === 'string') {
    return [v.start, v.end]
  }

  return v as JsonValue
}

function quietHoursToToml(q: Record<string, unknown>): TomlTable {
  const out: TomlTable = {}
  const keys = SECTIONS.quietHours.keys

  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue

    if (k === 'days') {
      if (!isTable(v)) throw unknownKey('quietHours.days')

      for (const [day, w] of Object.entries(v)) {
        if (!WEEKDAY_NAMES.includes(day)) throw unknownKey(`quietHours.days.${day}`)

        if (w !== undefined) out[day] = windowToToml(w)
      }
    } else if (k === 'default') out[keys[k]] = windowToToml(v)
    else if (has(keys, k)) out[keys[k]] = v as JsonValue
    else throw unknownKey(`quietHours.${k}`)
  }

  return out
}

function sectionToToml(name: string, v: unknown): JsonValue {
  // A section named as a whole (null) is removed as a whole.
  if (!isTable(v)) return v as JsonValue

  if (name === 'quietHours') return quietHoursToToml(v)
  const keys = SECTIONS[name].keys
  const out: TomlTable = {}

  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue

    if (name === 'jira' && k === 'projects') out.projects = x as JsonValue
    else if (has(keys, k)) out[keys[k]] = x as JsonValue
    else throw unknownKey(`${name}.${k}`)
  }

  return out
}

function reposToToml(repos: unknown): JsonValue {
  if (!isTable(repos)) return repos as JsonValue
  const out: TomlTable = {}

  for (const [name, entry] of Object.entries(repos)) {
    if (!isTable(entry)) {
      out[name] = entry as JsonValue

      continue
    }

    const e: TomlTable = {}

    for (const [k, v] of Object.entries(entry)) {
      if (v === undefined) continue

      if (!has(REPO_KEYS, k)) throw unknownKey(`repos.${name}.${k}`)
      e[REPO_KEYS[k]] = v as JsonValue
    }

    out[name] = e
  }

  return out
}

/**
 * A typed patch as a patch of the config file's table (snake_case keys, windows
 * as `[start, end]`, weekday overrides inside `[quiet_hours]`), ready for
 * `mergeConfigPatch`. `null` stays `null`, which the merge reads as a removal.
 * Throws on a key a patch does not have.
 */
export function patchToToml(patch: ConfigPatch): TomlTable {
  const out: TomlTable = {}

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue

    if (has(TOP_KEYS, k)) out[TOP_KEYS[k]] = v as JsonValue
    else if (k === 'repos') out.repos = reposToToml(v)
    else if (has(SECTIONS, k)) out[SECTIONS[k].table] = sectionToToml(k, v)
    else throw unknownKey(k)
  }

  return out
}

/**
 * The patch path (`['quietHours', 'unlockMinutes']`) of a dotted key as the file
 * spells it (`quiet_hours.unlock_minutes`). Throws on a key the config has no
 * place for.
 */
export function patchPathOf(key: string): string[] {
  const parts = key.split('.')
  const [head, second, third] = parts

  if (parts.length === 1) {
    const top = keyOf(TOP_KEYS, head)

    if (top) return [top]
  }

  if (head === 'repos' && (parts.length === 2 || parts.length === 3)) {
    if (parts.length === 2) return ['repos', second]
    const field = keyOf(REPO_KEYS, third)

    if (field) return ['repos', second, field]
  }

  const section = Object.keys(SECTIONS).find((s) => SECTIONS[s].table === head)

  if (section && parts.length === 2) {
    if (section === 'quietHours' && WEEKDAY_NAMES.includes(second)) {
      return ['quietHours', 'days', second]
    }

    const field = keyOf(SECTIONS[section].keys, second)

    if (field) return [section, field]
  }

  if (head === 'jira' && second === 'projects' && parts.length === 3) {
    return ['jira', 'projects', third]
  }

  throw unknownKey(key)
}

/** True where the patch holds a quiet-hours window: the default, or a weekday's override. */
export function isWindowPath(path: string[]): boolean {
  return (
    path[0] === 'quietHours' && (path[1] === 'default' || (path[1] === 'days' && path.length === 3))
  )
}
