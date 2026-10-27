// How a workspace's diff is drawn: a file's status glyph and tone, and the kind
// of each patch line. Shared by the Changes list and the diff tabs.
import type { DiffFile } from '../../preload/index.d'

export const GLYPH: Record<DiffFile['status'], { glyph: string; tone: string; label: string }> = {
  added: { glyph: 'A', tone: 'good', label: 'added' },
  // Grey: a modification is the ordinary case, and blue is kept for the working dot.
  modified: { glyph: 'M', tone: 'neutral', label: 'modified' },
  deleted: { glyph: 'D', tone: 'bad', label: 'deleted' },
  renamed: { glyph: 'R', tone: 'neutral', label: 'renamed' },
  untracked: { glyph: '?', tone: 'attention', label: 'untracked' }
}

export type LineKind = 'added' | 'removed' | 'hunk' | 'header' | 'context'

export function lineKind(line: string): LineKind {
  if (line.startsWith('@@')) return 'hunk'

  if (line.startsWith('diff --git') || line.startsWith('---') || line.startsWith('+++'))
    return 'header'

  if (line.startsWith('+')) return 'added'

  if (line.startsWith('-')) return 'removed'

  return 'context'
}

/** The last segment of a path: the file's name. */
export function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

/**
 * The new file's line number of each patch line (the same split the diff view draws: the
 * patch without its last newline, on `\n`), or null for a line the new file does not have:
 * a header, a hunk head, a removed line, `\ No newline at end of file`.
 */
export function newLineNumbers(patch: string): Array<number | null> {
  let next: number | null = null

  return patch
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => {
      const kind = lineKind(line)

      if (kind === 'hunk') {
        const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line)
        next = m ? Number(m[1]) : null

        return null
      }

      if (kind === 'header' || kind === 'removed' || next === null || line.startsWith('\\')) {
        return null
      }

      return next++
    })
}
