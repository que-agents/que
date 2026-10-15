// A brief is free text describing the work. Its first line is the title, and
// the title's slug names the workspace, its branch, and its folder.
import { slugify, WORKSPACE_NAME_RE } from './slug'

/** The brief's first non-empty line, trimmed, at most 80 characters. */
export function titleOf(brief: string): string {
  const first = brief.split('\n').find((l) => l.trim() !== '') ?? ''
  const line = first.trim()
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}

/** A workspace name from a title: its slug cut to 48 characters, or null when nothing usable is left. */
export function nameFromTitle(title: string): string | null {
  const slug = slugify(title)
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 48)
    .replace(/[-.]+$/, '')
  return WORKSPACE_NAME_RE.test(slug) ? slug : null
}
