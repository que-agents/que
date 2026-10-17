// Merging a config.set patch into the raw TOML table, apart from config.ts so
// the renderer's fake bridge can use it: no Node imports.

export function isTable(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)
}

/**
 * Deep-merges a patch into a TOML table without touching the input: tables
 * merge key by key, anything else replaces, and `null` removes the key.
 */
export function mergeConfigPatch(
  raw: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw }

  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else if (isTable(v) && isTable(out[k])) out[k] = mergeConfigPatch(out[k], v)
    else if (isTable(v)) out[k] = mergeConfigPatch({}, v)
    else out[k] = v
  }

  return out
}
