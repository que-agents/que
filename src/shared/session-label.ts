// The sidebar label a Claude Code session gives itself. Claude Code names a
// session from its first prompt (or `/rename`, `--name`) and writes the name
// to the terminal title: `✳ <name>` when idle or waiting, `◐ <name>` or
// `◑ <name>` while busy, `Claude Code` until the session has a name, and an
// empty title on exit.
import { capTitle } from './brief'

/** One status glyph Claude Code puts before the session name, and the whitespace after it. */
const GLYPH = /^[✳◐◑]\s*/u

/** The title Claude Code shows before the session has been named. */
const PLACEHOLDER = 'Claude Code'

/**
 * The session name in a raw terminal title: one leading status glyph and the
 * whitespace after it dropped, trimmed, at most MAX_TITLE_CHARS characters;
 * null for an empty title or the unnamed placeholder.
 */
export function sessionLabel(raw: string | undefined): string | null {
  const body = (raw ?? '').trim().replace(GLYPH, '').trim()

  if (body === '' || body === PLACEHOLDER) return null

  return capTitle(body)
}
