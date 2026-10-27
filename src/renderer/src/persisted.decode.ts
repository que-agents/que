// Decoders for what the renderer reads back from localStorage: JSON an earlier
// version (or a hand edit) may have written in any shape. Each checks the shape
// once and returns plain typed fields; the store and layout apply the domain
// rules (clamping, known tab names, view ids) to the result.
import { isObj, strings } from '../../shared/json.decode'

/** A remembered review pane, as stored. Fields that are missing or of the wrong type are null. */
export interface PersistedReview {
  open: boolean
  width: number | null
  /** Per workspace id: its view and the pull request open in it. */
  places: Record<string, { view: string | null; pr: number | null }>
  /** Per workspace id, then pull request number: when its conversation was last seen. */
  seen: Record<string, Record<number, string>>
}

/** A remembered pane layout, as stored: only the string and number fields survive. */
export interface PersistedLayout {
  split: { direction: 'row' | 'column'; ratio: number } | null
  second: string[]
  active: [string | null, string | null]
  focused: 0 | 1
  views: string[]
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

const positive = (v: unknown): number | null =>
  Number.isInteger(v) && Number(v) > 0 ? Number(v) : null

/** The entries of an object that `pick` keeps, or none when it is not an object. */
function entriesOf<T>(
  v: unknown,
  pick: (key: string, value: unknown) => T | null
): Record<string, T> {
  if (!isObj(v)) return {}

  return Object.fromEntries(
    Object.entries(v).flatMap(([key, value]) => {
      const kept = pick(key, value)

      return kept === null ? [] : [[key, kept]]
    })
  )
}

const nonEmpty = (_: string, v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null

/** The review pane state `que.review` holds, or null when it is not an object. */
export function decodeReview(v: unknown): PersistedReview | null {
  if (!isObj(v)) return null

  return {
    open: v.open === true,
    width: typeof v.width === 'number' ? v.width : null,
    places: entriesOf(v.places, (_, place) =>
      isObj(place) ? { view: stringOrNull(place.view), pr: positive(place.pr) } : null
    ),
    seen: entriesOf(v.seen, (_, prs) => {
      const times = entriesOf(prs, (n, at) =>
        positive(Number(n)) === null ? null : nonEmpty(n, at)
      )

      return Object.keys(times).length > 0 ? times : null
    })
  }
}

/** The per-workspace diff bases `que.diffBases` holds; entries that are not non-empty strings are dropped. */
export function decodeDiffBases(v: unknown): Record<string, string> {
  return entriesOf(v, nonEmpty)
}

/** A layout `que.layout.<key>` holds, or null when it is not an object. */
export function decodeLayout(v: unknown): PersistedLayout | null {
  if (!isObj(v)) return null
  const sp = isObj(v.split) ? v.split : null
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

/**
 * What `key` holds, read through `decode`; the fallback when nothing (or an empty string) is
 * stored, when storage is unavailable, or when `decode` throws on what it finds.
 */
export function readStored<T>(key: string, decode: (raw: string) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)

    return raw ? decode(raw) : fallback
  } catch {
    return fallback
  }
}

/** Remembers a value under `key`, or forgets the key for null; with no storage, nothing is kept. */
export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Nothing to remember into; the value still applies for this session.
  }
}
