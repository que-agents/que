// What a caught error says. A rejection or a thrown value can be anything;
// this is the one place that looks at it, for the daemon, the CLI, Electron
// main and the renderer alike.

/** The message of an Error, or the value as text. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The error's string `code`: an errno (`ENOENT`, `EPERM`, …) from `node:fs` or
 * `node:child_process`, or the daemon's code (`not_found`, …) on a bridge
 * rejection; null when it carries none.
 */
export function errorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null

  return typeof err.code === 'string' ? err.code : null
}
