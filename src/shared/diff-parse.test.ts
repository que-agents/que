import { describe, expect, it } from 'vitest'
import { isBinaryPatch, parseHunks, splitLines } from './diff-parse'

const PATCH = [
  'diff --git a/src/upload/put.ts b/src/upload/put.ts',
  'index 3b18e51..a7c2f0d 100644',
  '--- a/src/upload/put.ts',
  '+++ b/src/upload/put.ts',
  '@@ -3,4 +3,5 @@ export async function put(file: Blob) {',
  '   const url = await sign(file)',
  '-  const retries = 1',
  '+  const retries = 3',
  '+  const backoffMs = 250',
  ' ',
  '   return send(url, file)',
  '@@ -20 +21 @@',
  '-}',
  '+} // put',
  '\\ No newline at end of file',
  ''
].join('\n')

describe('parseHunks', () => {
  it('numbers each line from its hunk header and keeps the function context as the label', () => {
    const hunks = parseHunks(PATCH)

    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toMatchObject({
      oldStart: 3,
      oldLines: 4,
      newStart: 3,
      newLines: 5,
      label: 'export async function put(file: Blob) {'
    })
    expect(hunks[0]?.lines).toEqual([
      { kind: 'context', old: 3, new: 3, text: '  const url = await sign(file)' },
      { kind: 'removed', old: 4, new: null, text: '  const retries = 1' },
      { kind: 'added', old: null, new: 4, text: '  const retries = 3' },
      { kind: 'added', old: null, new: 5, text: '  const backoffMs = 250' },
      { kind: 'context', old: 5, new: 6, text: '' },
      { kind: 'context', old: 6, new: 7, text: '  return send(url, file)' }
    ])
  })

  it('reads a header without counts as one line, with no label, and drops the no-newline note', () => {
    const second = parseHunks(PATCH)[1]

    expect(second).toMatchObject({
      oldStart: 20,
      oldLines: 1,
      newStart: 21,
      newLines: 1,
      label: ''
    })
    expect(second?.lines).toEqual([
      { kind: 'removed', old: 20, new: null, text: '}' },
      { kind: 'added', old: null, new: 21, text: '} // put' }
    ])
  })

  it('keeps tabs and trailing spaces in a line', () => {
    const [hunk] = parseHunks('@@ -1 +1 @@\n-\tx = 1  \n+\tx = 2\t\n')

    expect(hunk?.lines.map((l) => l.text)).toEqual(['\tx = 1  ', '\tx = 2\t'])
  })

  it('finds no hunks in a binary notice', () => {
    const binary =
      'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n'

    expect(parseHunks(binary)).toEqual([])
    expect(isBinaryPatch(binary)).toBe(true)
    expect(isBinaryPatch(PATCH)).toBe(false)
  })
})

describe('splitLines', () => {
  it('numbers lines as git does: no extra line after a final newline', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
    expect(splitLines('a\n\n')).toEqual(['a', ''])
  })
})
