// A pull request's number from its URL, for the daemon and the renderer alike. No Node imports.

/** The number at the end of a pull request URL (`.../pull/<n>`, a trailing slash allowed); null for anything else. */
export function prUrlNumber(url: string | null | undefined): number | null {
  const m = url ? /\/pull\/(\d+)\/?$/.exec(url) : null

  return m ? Number(m[1]) : null
}
