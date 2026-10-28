// How a workspace's changed files are drawn: a file's status glyph and tone. Shared by the
// Changes list, the Files tree and a pull request's files.
import type { DiffFile } from '../../preload/index.d'

export const GLYPH: Record<DiffFile['status'], { glyph: string; tone: string; label: string }> = {
  added: { glyph: 'A', tone: 'good', label: 'added' },
  // Grey: a modification is the ordinary case, and blue is kept for the working dot.
  modified: { glyph: 'M', tone: 'neutral', label: 'modified' },
  deleted: { glyph: 'D', tone: 'bad', label: 'deleted' },
  renamed: { glyph: 'R', tone: 'neutral', label: 'renamed' },
  untracked: { glyph: '?', tone: 'attention', label: 'untracked' }
}

/** The last segment of a path: the file's name. */
export function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}
