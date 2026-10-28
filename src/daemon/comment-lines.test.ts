import { describe, expect, it } from 'vitest'
import type { DiffLine } from '../shared/protocol'
import { countCommentLines, type ListedFile, markCommentLines, withSplit } from './comment-lines'
import { buildHunks } from './diff-file'
import { tokenizeFile } from './highlight'
import { plainFile } from './syntax'

/** Every line of `source` as a changed line of `kind`, tokenized whole in `language`. */
function changed(
  source: string,
  language: string,
  kind: 'added' | 'removed' = 'added'
): DiffLine[] {
  return tokenizeFile(source, language).lines.map((tokens, i) => ({
    kind,
    old: kind === 'removed' ? i + 1 : null,
    new: kind === 'added' ? i + 1 : null,
    tokens
  }))
}

/** Each line's text and whether it was marked a comment line. */
const marked = (lines: DiffLine[]): [string, boolean][] =>
  markCommentLines(lines).map((l) => [l.tokens.map((t) => t.text).join(''), l.comment === true])

describe('markCommentLines', () => {
  describe('comments', () => {
    it('marks line comments, indented or not', () => {
      const source = ['// Retry the upload twice.', '  // Then give up.', ''].join('\n')

      expect(marked(changed(source, 'typescript'))).toEqual([
        ['// Retry the upload twice.', true],
        ['  // Then give up.', true]
      ])
    })

    it('marks every line of a block comment, its inner lines included', () => {
      const source = [
        '/*',
        '  const notCode = "inside the comment"',
        '  retries = 3',
        '*/',
        ''
      ].join('\n')

      expect(marked(changed(source, 'typescript')).map(([, c]) => c)).toEqual([
        true,
        true,
        true,
        true
      ])
    })

    it('marks a doc comment above the code it documents, but not the code', () => {
      const source = [
        '/**',
        ' * How many times an upload is tried.',
        ' * @default 3',
        ' */',
        'export const retries = 3',
        ''
      ].join('\n')

      expect(marked(changed(source, 'typescript')).map(([, c]) => c)).toEqual([
        true,
        true,
        true,
        true,
        false
      ])
    })

    it('marks a Python comment and counts a docstring as code, since it is a string', () => {
      const source = [
        'def upload(path):',
        '    """Send the file, retrying twice."""',
        '    # Back off between tries.',
        '    return send(path)',
        ''
      ].join('\n')

      expect(marked(changed(source, 'python'))).toEqual([
        ['def upload(path):', false],
        ['    """Send the file, retrying twice."""', false],
        ['    # Back off between tries.', true],
        ['    return send(path)', false]
      ])
    })

    it('marks a removed comment line', () => {
      const source = ['// Retries are fixed for now.', 'export const retries = 3', ''].join('\n')

      expect(marked(changed(source, 'typescript', 'removed'))).toEqual([
        ['// Retries are fixed for now.', true],
        ['export const retries = 3', false]
      ])
    })
  })

  describe('code', () => {
    it('treats code with a trailing comment as code', () => {
      const source = 'export const retries = 3 // twice is not enough\n'

      expect(marked(changed(source, 'typescript'))).toEqual([
        ['export const retries = 3 // twice is not enough', false]
      ])
    })

    it('never marks a file tokenized plain, even where its text looks like a comment', () => {
      const lines: DiffLine[] = plainFile('// Retry twice.\n').lines.map((tokens, i) => ({
        kind: 'added',
        old: null,
        new: i + 1,
        tokens
      }))

      expect(marked(lines)).toEqual([['// Retry twice.', false]])
    })

    it('leaves context lines unmarked', () => {
      const [line] = changed('// Retry twice.\n', 'typescript')

      expect(markCommentLines([{ ...line!, kind: 'context', old: 1, new: 1 }])[0]?.comment).toBe(
        undefined
      )
    })
  })

  describe('blank lines', () => {
    it('counts a blank line between two comment lines as a comment line', () => {
      const source = ['// Retry twice.', '', '// Then give up.', ''].join('\n')

      expect(marked(changed(source, 'typescript')).map(([, c]) => c)).toEqual([true, true, true])
    })

    it('counts a blank line between code lines, or between a comment and code, as code', () => {
      const source = [
        'const retries = 3',
        '',
        'const backoffMs = 250',
        '// Jitter keeps clients apart.',
        '',
        'const jitter = true',
        ''
      ].join('\n')

      expect(marked(changed(source, 'typescript')).map(([, c]) => c)).toEqual([
        false,
        false,
        false,
        true,
        false,
        false
      ])
    })

    it('counts a blank line at the edge of a run as code', () => {
      const source = ['', '// Retry twice.', ''].join('\n')

      expect(marked(changed(source, 'typescript')).map(([, c]) => c)).toEqual([false, true])
    })
  })

  describe('purity', () => {
    it('returns new lines and leaves its input untouched', () => {
      const lines = changed('// Retry twice.\n', 'typescript')
      const before = structuredClone(lines)

      const out = markCommentLines(lines)

      expect(lines).toEqual(before)
      expect(out[0]).not.toBe(lines[0])
    })
  })
})

describe('buildHunks', () => {
  it('flags the comment lines of a patch from whole-file tokens', () => {
    const before = ['/*', ' * Retry once.', ' */', 'export const retries = 1', ''].join('\n')
    const after = ['/*', ' * Retry twice.', ' */', 'export const retries = 3', ''].join('\n')

    const patch = [
      '@@ -1,4 +1,4 @@',
      ' /*',
      '- * Retry once.',
      '+ * Retry twice.',
      '  */',
      '-export const retries = 1',
      '+export const retries = 3',
      ''
    ].join('\n')

    const [hunk] = buildHunks(
      patch,
      tokenizeFile(before, 'typescript').lines,
      tokenizeFile(after, 'typescript').lines
    )

    expect(hunk?.lines.map((l) => [l.kind, l.comment === true])).toEqual([
      ['context', false],
      ['removed', true],
      ['added', true],
      ['context', false],
      ['removed', false],
      ['added', false]
    ])
    expect(countCommentLines(hunk?.lines ?? [])).toEqual({
      commentAdditions: 1,
      commentDeletions: 1
    })
  })
})

describe('withSplit', () => {
  const listed: ListedFile = {
    path: 'src/upload/put.ts',
    from: null,
    status: 'modified',
    additions: 4,
    deletions: 2,
    dirty: true,
    patch: null
  }

  it('is comment-only when every changed line is a comment line', () => {
    expect(withSplit(listed, { commentAdditions: 4, commentDeletions: 2 })).toMatchObject({
      commentOnly: true,
      codeAdditions: 0,
      commentAdditions: 4,
      codeDeletions: 0,
      commentDeletions: 2
    })
  })

  it('splits the counts of a file that changed both', () => {
    expect(withSplit(listed, { commentAdditions: 3, commentDeletions: 0 })).toMatchObject({
      commentOnly: false,
      codeAdditions: 1,
      commentAdditions: 3,
      codeDeletions: 2,
      commentDeletions: 0
    })
  })

  it('counts an unclassified file as all code', () => {
    expect(withSplit(listed, null)).toMatchObject({
      commentOnly: false,
      codeAdditions: 4,
      commentAdditions: 0,
      codeDeletions: 2,
      commentDeletions: 0
    })
  })

  it('never calls a file with no changed lines comment-only', () => {
    expect(
      withSplit(
        { ...listed, additions: 0, deletions: 0 },
        {
          commentAdditions: 0,
          commentDeletions: 0
        }
      ).commentOnly
    ).toBe(false)
  })
})
