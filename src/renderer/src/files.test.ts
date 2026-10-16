import { describe, expect, it } from 'vitest'
import type { DiffFile } from '../../preload/index.d'
import { buildTree, type DirNode, defaultExpanded, flatten, newlyChanged } from './files'
import { makeDiffFile } from './testing/fixtures'

function changes(...files: DiffFile[]): Map<string, DiffFile> {
  return new Map(files.map((f) => [f.path, f]))
}

/** Each row as `<level> <kind> <name>`. */
function outline(tree: DirNode, expanded: Iterable<string>): string[] {
  return flatten(tree, new Set(expanded)).map(
    (r) => `${r.level} ${r.node.kind} ${r.node.name}${r.open ? ' (open)' : ''}`
  )
}

describe('buildTree', () => {
  describe('ordering', () => {
    it('puts directories before files, each sorted without regard to case', () => {
      const tree = buildTree(
        ['b.ts', 'Zeta/x.ts', 'README.md', 'alpha/y.ts', 'a.ts', 'Beta/z.ts', 'beta/w.ts'],
        new Map()
      )

      expect(tree.dirs.map((d) => d.name)).toEqual(['alpha', 'Beta', 'beta', 'Zeta'])
      expect(tree.files.map((f) => f.name)).toEqual(['a.ts', 'b.ts', 'README.md'])
    })
  })

  describe('folding', () => {
    it('folds a directory whose only entry is another directory into one row', () => {
      const tree = buildTree(
        ['src/renderer/src/App.tsx', 'src/renderer/src/store.ts', 'src/main/index.ts'],
        new Map()
      )

      const src = tree.dirs[0]
      expect(src.name).toBe('src')
      expect(src.dirs.map((d) => [d.name, d.path])).toEqual([
        ['main', 'src/main'],
        ['renderer/src', 'src/renderer/src']
      ])
      expect(src.dirs[1].files.map((f) => f.path)).toEqual([
        'src/renderer/src/App.tsx',
        'src/renderer/src/store.ts'
      ])
    })

    it('does not fold a directory that also holds a file', () => {
      const tree = buildTree(['docs/guide/intro.md', 'docs/index.md'], new Map())

      expect(tree.dirs.map((d) => d.name)).toEqual(['docs'])
      expect(tree.dirs[0].dirs.map((d) => d.name)).toEqual(['guide'])
    })
  })

  describe('changes', () => {
    it('marks each changed file and counts them on every directory above', () => {
      const put = makeDiffFile({ path: 'src/upload/put.ts' })
      const retry = makeDiffFile({ path: 'src/upload/retry.ts', status: 'added' })

      const tree = buildTree(
        ['README.md', 'src/index.ts', 'src/upload/put.ts', 'src/upload/retry.ts', 'tests/a.ts'],
        changes(put, retry)
      )

      const [src, tests] = tree.dirs
      expect(tree.changed).toBe(2)
      expect(src.changed).toBe(2)
      expect(src.dirs[0].changed).toBe(2)
      expect(tests.changed).toBe(0)
      expect(src.dirs[0].files.map((f) => f.change?.status ?? null)).toEqual(['modified', 'added'])
      expect(src.files[0].change).toBeNull()
    })

    it('keeps a deleted file that the listing no longer has, and a renamed one at its new path', () => {
      const gone = makeDiffFile({ path: 'src/old.ts', status: 'deleted' })
      const moved = makeDiffFile({ path: 'src/new.ts', from: 'src/was.ts', status: 'renamed' })
      const tree = buildTree(['src/new.ts', 'src/keep.ts'], changes(gone, moved))

      const src = tree.dirs[0]
      expect(src.files.map((f) => f.path)).toEqual(['src/keep.ts', 'src/new.ts', 'src/old.ts'])
      expect(src.files[2].change?.status).toBe('deleted')
      expect(src.changed).toBe(2)
    })
  })

  describe('defaultExpanded', () => {
    it('opens every directory with a changed file beneath and nothing else', () => {
      const tree = buildTree(
        ['src/upload/put.ts', 'src/index.ts', 'src/lib/util.ts', 'tests/e2e/a.spec.ts'],
        changes(makeDiffFile({ path: 'src/upload/put.ts' }))
      )

      expect(defaultExpanded(tree)).toEqual(new Set(['src', 'src/upload']))
    })

    it('opens nothing when nothing changed', () => {
      expect(defaultExpanded(buildTree(['src/a.ts'], new Map()))).toEqual(new Set())
    })
  })
})

describe('flatten', () => {
  const tree = buildTree(
    ['README.md', 'src/index.ts', 'src/upload/put.ts', 'tests/e2e/a.spec.ts'],
    new Map()
  )

  it('shows only the top level when nothing is open', () => {
    expect(outline(tree, [])).toEqual(['1 dir src', '1 dir tests/e2e', '1 file README.md'])
  })

  it("lists an open directory's entries beneath it, one level deeper, in tree order", () => {
    expect(outline(tree, ['src', 'src/upload'])).toEqual([
      '1 dir src (open)',
      '2 dir upload (open)',
      '3 file put.ts',
      '2 file index.ts',
      '1 dir tests/e2e',
      '1 file README.md'
    ])
  })

  it('hides the entries of a directory inside a closed one', () => {
    expect(outline(tree, ['src/upload'])).toEqual([
      '1 dir src',
      '1 dir tests/e2e',
      '1 file README.md'
    ])
  })
})

describe('newlyChanged', () => {
  const listing = [
    'README.md',
    'docs/guide.md',
    'docs/faq.md',
    'src/index.ts',
    'src/upload/retry.ts',
    'tests/e2e/upload.spec.ts'
  ]

  const tree = (...files: DiffFile[]): DirNode => buildTree(listing, changes(...files))
  const index = makeDiffFile({ path: 'src/index.ts' })
  const retry = makeDiffFile({ path: 'src/upload/retry.ts' })
  const guide = makeDiffFile({ path: 'docs/guide.md' })
  const faq = makeDiffFile({ path: 'docs/faq.md' })
  const spec = makeDiffFile({ path: 'tests/e2e/upload.spec.ts' })

  it('names a directory that gains its first changed file', () => {
    expect(newlyChanged(tree(index), tree(index, guide))).toEqual(['docs'])
  })

  it('leaves out a directory that already held a change', () => {
    expect(newlyChanged(tree(guide), tree(guide, faq))).toEqual([])
  })

  it('names a directory deep inside one that already held a change', () => {
    expect(newlyChanged(tree(index), tree(index, retry))).toEqual(['src/upload'])
  })

  it('names a folded chain by its deepest path', () => {
    expect(newlyChanged(tree(index), tree(index, spec))).toEqual(['tests/e2e'])
  })

  it('counts every directory of a previous fold as holding its changes', () => {
    const folded = buildTree(['tests/e2e/upload.spec.ts'], changes(spec))

    const unfolded = buildTree(
      ['tests/e2e/upload.spec.ts', 'tests/unit/retry.test.ts'],
      changes(spec)
    )

    expect(newlyChanged(folded, unfolded)).toEqual([])
  })

  it('never names the root for a changed file at the top', () => {
    const readme = makeDiffFile({ path: 'README.md', status: 'added' })

    expect(newlyChanged(tree(), tree(readme))).toEqual([])
  })

  it('names every changed directory when there was no tree before', () => {
    expect(newlyChanged(null, tree(retry, guide))).toEqual(['docs', 'src', 'src/upload'])
  })

  it('names nothing when a directory loses its changes', () => {
    expect(newlyChanged(tree(index, guide), tree(index))).toEqual([])
  })
})
