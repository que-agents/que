// One file's unified diff, as git prints it, parsed into hunks of numbered
// lines. Text only: the tokens are laid on later (diff-file.ts).

/** A diff line before tokenizing: its kind, numbers, and text without the leading marker. */
export interface RawLine {
  kind: 'context' | 'added' | 'removed'
  old: number | null
  new: number | null
  text: string
}

export interface RawHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  label: string
  lines: RawLine[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

/**
 * Parses one file's `git diff` output into hunks. The header lines before the
 * first `@@` and the `\ No newline at end of file` notes are dropped; a hunk's
 * lines are numbered from its header. The output must not be trimmed: a
 * context line may be a lone space.
 */
export function parseHunks(patch: string): RawHunk[] {
  const hunks: RawHunk[] = []
  let hunk: RawHunk | null = null
  let oldNo = 0
  let newNo = 0
  const lines = patch.split('\n')

  // A trailing newline leaves one empty string after the last line.
  if (lines.at(-1) === '') lines.pop()

  for (const line of lines) {
    const header = HUNK_HEADER.exec(line)

    if (header) {
      const [, os = '0', ol, ns = '0', nl, label = ''] = header
      hunk = {
        oldStart: Number(os),
        oldLines: ol === undefined ? 1 : Number(ol),
        newStart: Number(ns),
        newLines: nl === undefined ? 1 : Number(nl),
        label,
        lines: []
      }
      hunks.push(hunk)
      oldNo = hunk.oldStart
      newNo = hunk.newStart
      continue
    }

    if (!hunk) continue
    const marker = line[0]
    const text = line.slice(1)

    if (marker === ' ') {
      hunk.lines.push({ kind: 'context', old: oldNo++, new: newNo++, text })
    } else if (marker === '-') {
      hunk.lines.push({ kind: 'removed', old: oldNo++, new: null, text })
    } else if (marker === '+') {
      hunk.lines.push({ kind: 'added', old: null, new: newNo++, text })
    } else if (marker === undefined) {
      // Some tools strip the space of an empty context line.
      hunk.lines.push({ kind: 'context', old: oldNo++, new: newNo++, text: '' })
    }
    // '\' is "No newline at end of file"; anything else is not a hunk line.
  }

  return hunks
}

/** True when git reported the file as binary instead of printing hunks. */
export function isBinaryPatch(patch: string): boolean {
  return /^Binary files .* differ$/m.test(patch) || /^GIT binary patch$/m.test(patch)
}

/** The lines of a file's text as git numbers them: split on newlines, no empty line after a final newline. */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')

  if (lines.at(-1) === '') lines.pop()

  return lines
}
