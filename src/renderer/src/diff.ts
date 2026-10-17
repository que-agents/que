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
