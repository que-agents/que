// Decoders for the arguments the renderer sends over IPC. The renderer is
// trusted code, but a reload or a stray call can still send anything; each
// handler reads its argument through one of these before acting on it.

/** The path `app:openInEditor` opens: an absolute path, or null for anything else. */
export function decodeAbsolutePath(v: unknown): string | null {
  return typeof v === 'string' && v.startsWith('/') ? v : null
}
