import { describe, expect, it } from 'vitest'
import {
  diffId,
  diffPathOf,
  fileId,
  filePathOf,
  isViewId,
  NO_SPLIT,
  type PaneLayout,
  parseLayout,
  placeIn,
  reconcileLayout
} from './layout'

const PUT = diffId('src/upload/put.ts')
const README = diffId('README.md')
const INDEX = fileId('src/index.ts')

const split = (over: Partial<PaneLayout> = {}): PaneLayout => ({
  split: { direction: 'row', ratio: 0.5 },
  second: [],
  active: [null, null],
  focused: 0,
  views: [],
  ...over
})

describe('diff ids', () => {
  it('names a file diff tab and reads the path back verbatim', () => {
    expect(PUT).toBe('view:diff:src/upload/put.ts')
    expect(diffPathOf(PUT)).toBe('src/upload/put.ts')
    expect(diffPathOf(diffId('docs/a file: with spaces.md'))).toBe('docs/a file: with spaces.md')
    expect(isViewId(PUT)).toBe(true)
  })

  it('is null for a terminal id, an empty path, the old view ids, and null', () => {
    expect(diffPathOf('t_01hzx3k9c2qf')).toBeNull()
    expect(diffPathOf('view:diff:')).toBeNull()
    expect(diffPathOf('view:changes')).toBeNull()
    expect(diffPathOf(null)).toBeNull()
    expect(isViewId('t_01hzx3k9c2qf')).toBe(false)
    expect(isViewId('view:pr')).toBe(false)
  })
})

describe('file ids', () => {
  it('names a worktree file tab and reads the path back verbatim', () => {
    expect(INDEX).toBe('view:file:src/index.ts')
    expect(filePathOf(INDEX)).toBe('src/index.ts')
    expect(filePathOf(fileId('docs/a file: with spaces.md'))).toBe('docs/a file: with spaces.md')
    expect(isViewId(INDEX)).toBe(true)
  })

  it('keeps the two kinds apart, and is null for a terminal id, an empty path, and null', () => {
    expect(filePathOf(PUT)).toBeNull()
    expect(diffPathOf(INDEX)).toBeNull()
    expect(filePathOf('t_01hzx3k9c2qf')).toBeNull()
    expect(filePathOf('view:file:')).toBeNull()
    expect(filePathOf(null)).toBeNull()
  })
})

describe('parseLayout', () => {
  describe('round trip', () => {
    it('reads back a split holding diff tabs in either pane', () => {
      const l = split({
        second: ['t_2', README],
        active: [PUT, README],
        focused: 1,
        views: [PUT, README]
      })

      expect(parseLayout(JSON.stringify(l))).toEqual(l)
    })

    it('reads back one pane with a diff tab, which is worth remembering on its own', () => {
      const l: PaneLayout = { ...NO_SPLIT, active: [PUT, null], views: [PUT] }

      expect(parseLayout(JSON.stringify(l))).toEqual(l)
    })
  })

  describe('file tabs', () => {
    it('keeps a file tab beside a diff tab, in either pane', () => {
      const l = split({
        second: ['t_2', INDEX],
        active: [PUT, INDEX],
        focused: 1,
        views: [PUT, INDEX]
      })

      expect(parseLayout(JSON.stringify(l))).toEqual(l)
      expect(
        parseLayout(JSON.stringify({ ...NO_SPLIT, views: [INDEX, 'view:file:', INDEX] }))?.views
      ).toEqual([INDEX])
    })
  })

  describe('validation', () => {
    it('keeps only diff ids, once each, and forgets one pane with none', () => {
      const parsed = parseLayout(
        JSON.stringify({
          ...split(),
          views: [README, 'view:changes', 3, README, 'view:diff:', PUT]
        })
      )

      expect(parsed?.views).toEqual([README, PUT])
      expect(parseLayout(JSON.stringify({ ...NO_SPLIT, views: ['changes', 'pr'] }))).toBeNull()
      expect(parseLayout(JSON.stringify({ split: null }))).toBeNull()
      expect(parseLayout('{not json')).toBeNull()
    })

    it('reads a layout remembered before view tabs existed', () => {
      const old = {
        split: { direction: 'column', ratio: 0.3 },
        second: ['t_2'],
        active: [null, 't_2'],
        focused: 1
      }

      expect(parseLayout(JSON.stringify(old))).toEqual({ ...old, views: [] })
    })
  })
})

describe('reconcileLayout', () => {
  describe('diff tabs', () => {
    it('keeps an open diff tab when every terminal of its pane is gone', () => {
      const l = split({
        second: ['t_2', README],
        active: ['t_1', 't_2'],
        focused: 1,
        views: [README]
      })

      const next = reconcileLayout(l, new Set(['t_1']), ['t_1'])

      expect(next.split).toEqual(l.split)
      expect(next.second).toEqual([README])
      expect(next.active).toEqual(['t_1', null])
      expect(next.views).toEqual([README])
    })

    it('does not collapse a first pane that holds only a diff tab', () => {
      const l = split({ second: ['t_1'], active: [PUT, 't_1'], views: [PUT] })

      const next = reconcileLayout(l, new Set(['t_1']), ['t_1'])

      expect(next).toEqual(l)
    })

    it('drops a diff id that is no longer open, collapsing an emptied second pane', () => {
      const l = split({
        second: [README],
        active: ['t_1', README],
        focused: 1,
        views: [PUT]
      })

      const next = reconcileLayout(l, new Set(['t_1']), ['t_1'])

      expect(next).toEqual({ ...NO_SPLIT, active: ['t_1', null], views: [PUT] })
    })

    it('hands the second pane over, diff tabs and all, when the first is empty', () => {
      const l = split({
        second: ['t_2', README],
        active: ['t_1', README],
        focused: 1,
        views: [README]
      })

      const next = reconcileLayout(l, new Set(['t_2']), ['t_2'])

      expect(next).toEqual({ ...NO_SPLIT, active: [README, null], views: [README] })
    })
  })

  describe('purity', () => {
    it('leaves its input untouched', () => {
      const l = split({ second: ['t_2', README], active: ['t_1', 't_2'], views: [README] })
      const before = structuredClone(l)

      reconcileLayout(l, new Set(['t_1']), ['t_1'])

      expect(l).toEqual(before)
    })
  })
})

describe('placeIn', () => {
  it('appends a new tab to the second pane and selects and focuses it there', () => {
    const l = split({ second: ['term_01hzx9b2'], active: ['term_01hzx8a1', 'term_01hzx9b2'] })

    expect(placeIn(l, 1, PUT, { append: true })).toEqual({
      ...l,
      second: ['term_01hzx9b2', PUT],
      active: ['term_01hzx8a1', PUT],
      focused: 1
    })
  })

  it('selects a new tab in the first pane without listing it in the second', () => {
    const l = split({ second: ['term_01hzx9b2'], active: [null, 'term_01hzx9b2'], focused: 1 })

    expect(placeIn(l, 0, README, { append: true })).toEqual({
      ...l,
      active: [README, 'term_01hzx9b2'],
      focused: 0
    })
  })

  it('selects a tab already in the second pane without adding it again', () => {
    const l = split({
      second: ['term_01hzx9b2', INDEX],
      active: ['term_01hzx8a1', 'term_01hzx9b2']
    })
    const next = placeIn(l, 1, INDEX, { append: false })

    expect(next.second).toEqual(['term_01hzx9b2', INDEX])
    expect(next.active).toEqual(['term_01hzx8a1', INDEX])
    expect(next.focused).toBe(1)
    expect(l.active).toEqual(['term_01hzx8a1', 'term_01hzx9b2'])
  })
})
