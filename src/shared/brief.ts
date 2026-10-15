// A brief is free text describing the work. Its first line is the title, and
// the title's slug names the workspace, its branch, and its folder.
import { slugify, WORKSPACE_NAME_RE } from './slug'

/** The brief's first non-empty line, trimmed, at most 80 characters. */
export function titleOf(brief: string): string {
  const first = brief.split('\n').find((l) => l.trim() !== '') ?? ''
  const line = first.trim()
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}

/**
 * What `.que/brief.md` holds: `# <title>`, a blank line, then the brief; or the brief alone
 * when its first non-empty line is already a `# ` heading.
 */
export function briefFile(title: string, brief: string): string {
  const body = `${brief.trimEnd()}\n`
  const first = brief.split('\n').find((l) => l.trim() !== '') ?? ''
  return first.trimStart().startsWith('# ') ? body : `# ${title}\n\n${body}`
}

/** A workspace name from a title: its slug cut to 48 characters, or null when nothing usable is left. */
export function nameFromTitle(title: string): string | null {
  const slug = slugify(title)
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 48)
    .replace(/[-.]+$/, '')
  return WORKSPACE_NAME_RE.test(slug) ? slug : null
}
