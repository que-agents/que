// What the renderer shows for a failed bridge call. A rejection can carry any
// value; this is the one place that looks at it.

/** The message of an Error, or the value as text. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The daemon's error code (`not_found`, …) a rejection carries, or null. */
export function errorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null

  return typeof err.code === 'string' ? err.code : null
}
