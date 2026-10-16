// Decoders for what the renderer reads back from localStorage: JSON an earlier
// version (or a hand edit) may have written in any shape. Each checks the shape
// once and returns plain typed fields; the store and layout apply the domain
// rules (clamping, known tab names, view ids) to the result.

/** A remembered review pane, as stored. Fields that are missing or of the wrong type are null. */
export interface PersistedReview {
  open: boolean
  tab: string | null
  width: number | null
}

/** A remembered pane layout, as stored: only the string and number fields survive. */
export interface PersistedLayout {
  split: { direction: 'row' | 'column'; ratio: number } | null
  second: string[]
  active: [string | null, string | null]
  focused: 0 | 1
  views: string[]
}

function isObject(v: unknown): v is { [key: string]: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** The review pane state `que.review` holds, or null when it is not an object. */
export function decodeReview(v: unknown): PersistedReview | null {
  if (!isObject(v)) return null

  return {
    open: v.open === true,
    tab: stringOrNull(v.tab),
    width: typeof v.width === 'number' ? v.width : null
  }
}

/** The per-workspace diff bases `que.diffBases` holds; entries that are not non-empty strings are dropped. */
export function decodeDiffBases(v: unknown): Record<string, string> {
  if (!isObject(v)) return {}

  return Object.fromEntries(
    Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '')
  )
}

/** A layout `que.layout.<key>` holds, or null when it is not an object. */
export function decodeLayout(v: unknown): PersistedLayout | null {
  if (!isObject(v)) return null
  const sp = isObject(v.split) ? v.split : null
  const direction = sp?.direction

  const split: PersistedLayout['split'] =
    sp && (direction === 'row' || direction === 'column')
      ? { direction, ratio: Number(sp.ratio) }
      : null

  const active = Array.isArray(v.active) ? v.active : []

  return {
    split,
    second: strings(v.second),
    active: [stringOrNull(active[0]), stringOrNull(active[1])],
    focused: v.focused === 1 ? 1 : 0,
    views: strings(v.views)
  }
}
