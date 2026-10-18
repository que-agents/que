// Merging a config.set patch into the raw TOML table, apart from config.ts so
// the renderer's fake bridge can use it: no Node imports.
import { isObj } from './json.decode'

/** A plain object that is not a date (smol-toml reads a TOML date as one). */
export function isTable(v: unknown): v is Record<string, unknown> {
  return isObj(v) && !(v instanceof Date)
}

/**
 * Deep-merges a patch into a TOML table without touching the input: tables
 * merge key by key, anything else replaces, and `null` removes the key (or,
 * with `keepNull`, is kept as a value, to combine two patches).
 */
export function mergeConfigPatch(
  raw: Record<string, unknown>,
  patch: Record<string, unknown>,
  keepNull = false
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw }

  for (const [k, v] of Object.entries(patch)) {
    if (v === null && !keepNull) delete out[k]
    else if (isTable(v) && isTable(out[k])) out[k] = mergeConfigPatch(out[k], v, keepNull)
    else if (isTable(v)) out[k] = mergeConfigPatch({}, v, keepNull)
    else out[k] = v
  }

  return out
}
