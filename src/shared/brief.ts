// A brief is free text describing the work; its first line is the title.

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
