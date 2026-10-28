// Which changed lines of a diff only touch comments, from the tokens the
// whole-file tokenizing laid on them (diff-file.ts). A line is a comment line
// when every token with visible text is a comment, so the inner lines of a
// block or doc comment count too; code with a trailing comment does not. A
// blank changed line counts with the comment run it sits in. A string is code,
// so a docstring is code. A file tokenized plain (no grammar, a timeout, a
// crash) has no comment tokens, so none of its lines are comment lines.
import type { DiffFile, DiffLine } from '../shared/protocol'

type Kind = 'comment' | 'code' | 'blank'

function kindOf(line: DiffLine): Kind {
  const visible = line.tokens.filter((t) => t.text.trim() !== '')

  if (visible.length === 0) return 'blank'

  return visible.every((t) => t.kind === 'comment') ? 'comment' : 'code'
}

/**
 * Sets `comment` on the added and removed lines that are comment lines.
 * Returns new lines. A blank one is a comment line when the nearest non-blank
 * lines above and below it in its run of added (or removed) lines both are,
 * so a blank line between two comments counts and one beside code does not.
 */
export function markCommentLines(lines: readonly DiffLine[]): DiffLine[] {
  const out: DiffLine[] = lines.map((l) => ({
    kind: l.kind,
    old: l.old,
    new: l.new,
    tokens: l.tokens
  }))

  let i = 0

  while (i < out.length) {
    const kind = out[i]?.kind

    if (kind === 'context') {
      i += 1
      continue
    }

    const start = i

    while (i < out.length && out[i]?.kind === kind) i += 1
    const run = out.slice(start, i)
    const kinds = run.map(kindOf)

    const nearest = (from: number, step: 1 | -1): Kind | undefined => {
      for (let k = from + step; k >= 0 && k < kinds.length; k += step) {
        if (kinds[k] !== 'blank') return kinds[k]
      }

      return undefined
    }

    run.forEach((line, k) => {
      const isComment =
        kinds[k] === 'comment' ||
        (kinds[k] === 'blank' && nearest(k, -1) === 'comment' && nearest(k, 1) === 'comment')

      if (isComment) line.comment = true
    })
  }

  return out
}

/** How many of a file's added and removed lines are comment lines. */
export interface CommentSplit {
  commentAdditions: number
  commentDeletions: number
}

/** How many added and removed lines are comment lines. */
export function countCommentLines(lines: readonly DiffLine[]): CommentSplit {
  let commentAdditions = 0
  let commentDeletions = 0

  for (const l of lines) {
    if (!l.comment) continue

    if (l.kind === 'added') commentAdditions += 1
    else if (l.kind === 'removed') commentDeletions += 1
  }

  return { commentAdditions, commentDeletions }
}

/** A file of workspace.diff's list before its changed lines are split into code and comments. */
export type ListedFile = Omit<
  DiffFile,
  'commentOnly' | 'codeAdditions' | 'codeDeletions' | 'commentAdditions' | 'commentDeletions'
>

/** The file with its counts split by `split`; null (not classified) counts every line as code. */
export function withSplit(file: ListedFile, split: CommentSplit | null): DiffFile {
  const commentAdditions = Math.min(split?.commentAdditions ?? 0, file.additions)
  const commentDeletions = Math.min(split?.commentDeletions ?? 0, file.deletions)

  return {
    ...file,
    commentOnly:
      file.additions + file.deletions > 0 &&
      commentAdditions === file.additions &&
      commentDeletions === file.deletions,
    codeAdditions: file.additions - commentAdditions,
    commentAdditions,
    codeDeletions: file.deletions - commentDeletions,
    commentDeletions
  }
}
