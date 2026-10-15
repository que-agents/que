import { describe, expect, it } from 'vitest'
import {
  NO_SPLIT,
  type PaneLayout,
  parseLayout,
  reconcileLayout,
  viewId,
  viewKindOf
} from './layout'

const split = (over: Partial<PaneLayout> = {}): PaneLayout => ({
  split: { direction: 'row', ratio: 0.5 },
  second: [],
  active: [null, null],
  focused: 0,
  views: [],
  ...over
})

describe('view ids', () => {
  it('names a view tab and reads it back; a terminal id is not a view', () => {
    expect(viewId('changes')).toBe('view:changes')
    expect(viewKindOf('view:pr')).toBe('pr')
    expect(viewKindOf('view:nope')).toBeNull()
    expect(viewKindOf('t_01hzx3k9c2qf')).toBeNull()
    expect(viewKindOf(null)).toBeNull()
  })
})

describe('parseLayout', () => {
  describe('round trip', () => {
    it('reads back a split holding view tabs in either pane', () => {
      const l = split({
        second: ['t_2', 'view:pr'],
        active: ['view:changes', 'view:pr'],
        focused: 1,
        views: ['changes', 'pr']
      })

      expect(parseLayout(JSON.stringify(l))).toEqual(l)
    })

    it('reads back one pane with a view tab, which is worth remembering on its own', () => {
      const l: PaneLayout = { ...NO_SPLIT, active: ['view:changes', null], views: ['changes'] }

      expect(parseLayout(JSON.stringify(l))).toEqual(l)
    })
  })

  describe('validation', () => {
    it('drops unknown and repeated views, and forgets one pane with none', () => {
      const parsed = parseLayout(
        JSON.stringify({ ...split(), views: ['pr', 'files', 3, 'pr', 'changes'] })
      )
      expect(parsed?.views).toEqual(['pr', 'changes'])
      expect(parseLayout(JSON.stringify({ ...NO_SPLIT, views: ['files'] }))).toBeNull()
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
  describe('view tabs', () => {
    it('keeps an open view when every terminal of its pane is gone', () => {
      const l = split({
        second: ['t_2', 'view:pr'],
        active: ['t_1', 't_2'],
        focused: 1,
        views: ['pr']
      })

      const next = reconcileLayout(l, new Set(['t_1']), ['t_1'])

      expect(next.split).toEqual(l.split)
      expect(next.second).toEqual(['view:pr'])
      expect(next.active).toEqual(['t_1', null])
      expect(next.views).toEqual(['pr'])
    })

    it('does not collapse a first pane that holds only a view tab', () => {
      const l = split({ second: ['t_1'], active: ['view:changes', 't_1'], views: ['changes'] })

      const next = reconcileLayout(l, new Set(['t_1']), ['t_1'])

      expect(next).toEqual(l)
    })

    it('drops a view id that is no longer open, collapsing an emptied second pane', () => {
      const l = split({
        second: ['view:pr'],
        active: ['t_1', 'view:pr'],
        focused: 1,
        views: ['changes']
      })

      const next = reconcileLayout(l, new Set(['t_1']), ['t_1'])

      expect(next).toEqual({ ...NO_SPLIT, active: ['t_1', null], views: ['changes'] })
    })

    it('hands the second pane over, view tabs and all, when the first is empty', () => {
      const l = split({
        second: ['t_2', 'view:pr'],
        active: ['t_1', 'view:pr'],
        focused: 1,
        views: ['pr']
      })

      const next = reconcileLayout(l, new Set(['t_2']), ['t_2'])

      expect(next).toEqual({ ...NO_SPLIT, active: ['view:pr', null], views: ['pr'] })
    })
  })

  describe('purity', () => {
    it('leaves its input untouched', () => {
      const l = split({ second: ['t_2', 'view:pr'], active: ['t_1', 't_2'], views: ['pr'] })
      const before = structuredClone(l)

      reconcileLayout(l, new Set(['t_1']), ['t_1'])

      expect(l).toEqual(before)
    })
  })
})
