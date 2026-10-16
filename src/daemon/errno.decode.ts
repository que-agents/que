// Decodes the error a `node:fs` or `node:child_process` call throws (an
// unknown value) into its errno code.

/** The error's `code` (`ENOENT`, `EPERM`, …), or null when it carries none. */
export function errnoCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null

  return typeof err.code === 'string' ? err.code : null
}
