import { describe, expect, it } from 'vitest'
import {
  capPatch,
  MAX_PATCH_CHARS,
  MAX_BASES,
  mergeListings,
  orderBases,
  parseLog,
  parseNameStatus,
  parseNumstat,
  parsePorcelainPaths,
  parseRenamePath,
  parseRefs
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

describe('parseLog', () => {
  const A = '9f2c4e1a7b3d5f6e8a0c2b4d6f8e0a1c3b5d7f9e'
  const B = '1b3d5f7e9a2c4e6f8b0d1a3c5e7f9b2d4f6a8c0e'
  const C = 'c0ffee0123456789abcdef0123456789abcdef01'

  it('reads three commits newest first, keeping punctuation in subjects', () => {
    const out = [
      `${A}\0Retry uploads: back off (2x, max 30s) & log it\0Dana Reyes\x002026-10-14T21:05:00-04:00`,
      `${B}\0Add the uploader\0Sam Okafor\x002026-10-13T09:00:00-04:00`,
      `${C}\0Initial commit\0Dana Reyes\x002026-10-12T08:30:00-04:00`
    ].join('\n')

    expect(parseLog(out)).toEqual([
      {
        sha: A,
        shortSha: '9f2c4e1',
        subject: 'Retry uploads: back off (2x, max 30s) & log it',
        author: 'Dana Reyes',
        at: '2026-10-14T21:05:00-04:00'
      },
      {
        sha: B,
        shortSha: '1b3d5f7',
        subject: 'Add the uploader',
        author: 'Sam Okafor',
        at: '2026-10-13T09:00:00-04:00'
      },
      {
        sha: C,
        shortSha: 'c0ffee0',
        subject: 'Initial commit',
        author: 'Dana Reyes',
        at: '2026-10-12T08:30:00-04:00'
      }
    ])
  })

  it('gives no commits for blank output', () => {
    expect(parseLog('')).toEqual([])
    expect(parseLog('\n')).toEqual([])
  })
})

describe('parseRefs', () => {
  it('shortens local and origin refs and drops the remote HEAD pointer', () => {
    const out = [
      'refs/heads/main',
      'refs/heads/app-1432-retry-logic',
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/main',
      'refs/remotes/origin/release',
      ''
    ].join('\n')

    expect(parseRefs(out)).toEqual([
      'main',
      'app-1432-retry-logic',
      'origin/main',
      'origin/release'
    ])
  })

  it('gives no refs for blank output', () => {
    expect(parseRefs('')).toEqual([])
    expect(parseRefs('\n')).toEqual([])
  })
})

describe('orderBases', () => {
  it('puts the chosen base first, then the default branch here and on origin', () => {
    const refs = ['APP-1500-diff-view', 'main', 'release', 'origin/main', 'origin/release']

    expect(orderBases('origin/main', 'main', refs)).toEqual([
      'origin/main',
      'main',
      'APP-1500-diff-view',
      'release',
      'origin/release'
    ])
  })

  it('keeps a chosen base that is not a branch and skips a default branch that does not exist', () => {
    expect(orderBases('v1.2.0', 'main', ['release', 'origin/main'])).toEqual([
      'v1.2.0',
      'origin/main',
      'release'
    ])
  })

  it('offers at most 50 refs', () => {
    const refs = Array.from({ length: 80 }, (_, i) => `feature-${i}`)

    const bases = orderBases('main', 'main', ['main', ...refs])

    expect(bases).toHaveLength(MAX_BASES)
    expect(bases.slice(0, 2)).toEqual(['main', 'feature-0'])
  })
})
