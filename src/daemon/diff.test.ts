import { describe, expect, it } from 'vitest'
import {
  capPatch,
  MAX_PATCH_CHARS,
  mergeListings,
  parseNameStatus,
  parseNumstat,
  parsePorcelainPaths,
  parseRenamePath
} from './diff'

describe('parseRenamePath', () => {
  it('reads a plain rename', () => {
    expect(parseRenamePath('old.ts => new.ts')).toEqual({ from: 'old.ts', path: 'new.ts' })
  })

  it('reads a braced rename in a directory', () => {
    expect(parseRenamePath('src/{a => b}/x.ts')).toEqual({ from: 'src/a/x.ts', path: 'src/b/x.ts' })
  })

  it('collapses an empty side of the braces', () => {
    expect(parseRenamePath('src/{ => lib}/x.ts')).toEqual({
      from: 'src/x.ts',
      path: 'src/lib/x.ts'
    })
    expect(parseRenamePath('src/{lib => }/x.ts')).toEqual({
      from: 'src/lib/x.ts',
      path: 'src/x.ts'
    })
  })

  it('leaves an ordinary path alone', () => {
    expect(parseRenamePath('a/b.ts')).toEqual({ from: 'a/b.ts', path: 'a/b.ts' })
  })
})

describe('parseNumstat', () => {
  it('reads counts, renames, and binary files', () => {
    const out = ['12\t3\tsrc/a.ts', '1\t0\told.md => new.md', '-\t-\timg.png', ''].join('\n')
    expect(parseNumstat(out)).toEqual([
      { path: 'src/a.ts', from: null, additions: 12, deletions: 3, binary: false },
      { path: 'new.md', from: 'old.md', additions: 1, deletions: 0, binary: false },
      { path: 'img.png', from: null, additions: 0, deletions: 0, binary: true }
    ])
  })
})

describe('mergeListings', () => {
  it('joins statuses to counts on the new path and marks dirty files', () => {
    const numstat = parseNumstat('1\t1\ta.ts\n2\t0\tb.ts\n0\t0\tc.ts => d.ts')
    const names = parseNameStatus('M\ta.ts\nA\tb.ts\nR100\tc.ts\td.ts')
    const files = mergeListings(numstat, names, new Set(['a.ts']))
    expect(files.map((f) => [f.path, f.status, f.from, f.dirty])).toEqual([
      ['a.ts', 'modified', null, true],
      ['b.ts', 'added', null, false],
      ['d.ts', 'renamed', 'c.ts', false]
    ])
  })

  it('maps deleted files', () => {
    expect(parseNameStatus('D\tgone.ts').get('gone.ts')).toEqual({ status: 'deleted', from: null })
  })
})

describe('parsePorcelainPaths', () => {
  it('takes the new path of a rename and includes untracked files', () => {
    const out = 'M a.ts\nR  old.ts -> new.ts\n?? fresh.ts'
    expect([...parsePorcelainPaths(out)]).toEqual(['a.ts', 'new.ts', 'fresh.ts'])
  })
})

describe('capPatch', () => {
  it('keeps a patch at the limit and drops one past it', () => {
    expect(capPatch('x'.repeat(MAX_PATCH_CHARS))).not.toBeNull()
    expect(capPatch('x'.repeat(MAX_PATCH_CHARS + 1))).toBeNull()
  })
})
