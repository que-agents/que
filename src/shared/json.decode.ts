// The small guards every decoder reads parsed JSON with: an object's fields,
// strings, numbers, and lists of either. No Node imports: the renderer uses it too.

export type Obj = { [key: string]: unknown }

/** A plain object (not null, not an array). */
export const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The object's fields, or none when it is not a plain object. */
export const fieldsOf = (v: unknown): Obj => (isObj(v) ? v : {})

/** The plain objects in a list; none when it is not a list. */
export const objects = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])

/** The strings in a list; none when it is not a list. */
export const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** A string, or empty for anything else. */
export const strOrEmpty = (v: unknown): string => (typeof v === 'string' ? v : '')

/** A non-empty string, else null. */
export const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

export const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null)
