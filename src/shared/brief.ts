// A brief is free text describing the work; its first line is the title. It is
// written verbatim to `<worktree>/.que/brief.md` and, by default, is the first
// prompt claude starts on.

/** The longest workspace title, in characters. */
export const MAX_TITLE_CHARS = 80

/** A one-line title cut to MAX_TITLE_CHARS, ending in `…` when it was longer. */
export function capTitle(line: string): string {
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line
}

/** The brief's first non-empty line, trimmed, at most MAX_TITLE_CHARS characters. */
export function titleOf(brief: string): string {
  const first = brief.split('\n').find((l) => l.trim() !== '') ?? ''

  return capTitle(first.trim())
}

/** Offered in Settings when the user turns on a start prompt instead of the brief. */
export const SUGGESTED_START_PROMPT =
  'Read .que/brief.md. Restate the goal, read the relevant code, and propose a plan before editing anything.'
