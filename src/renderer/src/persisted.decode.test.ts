import { afterEach, describe, expect, it } from 'vitest'
import {
  decodeDiffBases,
  decodeLayout,
  decodeReview,
  readStored,
  writeStored
} from './persisted.decode'

describe('decodeReview', () => {
  it('reads back the review pane the store writes', () => {
    const stored = JSON.parse(
      '{"open":true,"view":"files","width":412,' +
        '"places":{"ws_01hzx3k9c2qf":{"view":"prs","pr":188},"ws_01hzx4m1p8rt":{"view":"changes","pr":null}}}'
    )

    expect(decodeReview(stored)).toEqual({
      open: true,
      view: 'files',
      width: 412,
      places: {
        ws_01hzx3k9c2qf: { view: 'prs', pr: 188 },
        ws_01hzx4m1p8rt: { view: 'changes', pr: null }
      }
    })
  })

  it('reads an older memory: its tab is the view, Pull request now the pull requests', () => {
    expect(decodeReview({ open: true, tab: 'pr', width: 320 })).toEqual({
      open: true,
      view: 'prs',
      width: 320,
      places: {}
    })
    expect(decodeReview({ open: false, tab: 'files', width: 320 })?.view).toBe('files')
  })

  it('nulls out fields of the wrong type and drops anything that is not an object', () => {
    expect(
      decodeReview({
        open: 'yes',
        view: 3,
        width: '400',
        places: { ws_a: 'prs', ws_b: { view: 4, pr: '188' }, ws_c: { view: 'prs', pr: -1 } }
      })
    ).toEqual({
      open: false,
      view: null,
      width: null,
      places: { ws_b: { view: null, pr: null }, ws_c: { view: 'prs', pr: null } }
    })
    expect(decodeReview(null)).toBeNull()
    expect(decodeReview(['changes'])).toBeNull()
    expect(decodeReview('changes')).toBeNull()
  })
})

describe('decodeDiffBases', () => {
  it('reads back the per-workspace bases the store writes', () => {
    const stored = JSON.parse('{"ws_01hzx3k9c2qf":"origin/main","ws_01hzx4m1p8rt":"release/2.4"}')

    expect(decodeDiffBases(stored)).toEqual({
      ws_01hzx3k9c2qf: 'origin/main',
      ws_01hzx4m1p8rt: 'release/2.4'
    })
  })

  it('drops entries that are not non-empty strings, and anything that is not an object', () => {
    expect(
      decodeDiffBases({ ws_01hzx3k9c2qf: 'origin/main', ws_a: '', ws_b: 7, ws_c: null })
    ).toEqual({ ws_01hzx3k9c2qf: 'origin/main' })
    expect(decodeDiffBases(['origin/main'])).toEqual({})
    expect(decodeDiffBases(null)).toEqual({})
  })
})

describe('decodeLayout', () => {
  it('reads back a split layout the store writes', () => {
    const stored = JSON.parse(
      '{"split":{"direction":"column","ratio":0.35},"second":["term_01hzx9"],' +
        '"active":["view:diff:src/upload/put.ts","term_01hzx9"],"focused":1,' +
        '"views":["view:diff:src/upload/put.ts"]}'
    )

    expect(decodeLayout(stored)).toEqual({
      split: { direction: 'column', ratio: 0.35 },
      second: ['term_01hzx9'],
      active: ['view:diff:src/upload/put.ts', 'term_01hzx9'],
      focused: 1,
      views: ['view:diff:src/upload/put.ts']
    })
  })

  it('keeps only the well-typed parts of a malformed layout', () => {
    expect(
      decodeLayout({
        split: { direction: 'diagonal', ratio: 0.5 },
        second: ['term_01hzx9', 4, null],
        active: 'term_01hzx9',
        focused: '1',
        views: 'view:diff:README.md'
      })
    ).toEqual({ split: null, second: ['term_01hzx9'], active: [null, null], focused: 0, views: [] })
  })

  it('drops anything that is not an object', () => {
    expect(decodeLayout(null)).toBeNull()
    expect(decodeLayout([])).toBeNull()
    expect(decodeLayout(42)).toBeNull()
  })
})

describe('readStored and writeStored', () => {
  afterEach(() => localStorage.clear())

  it('reads back what was written, and the fallback once it is forgotten', () => {
    writeStored('que.sidebarSort', 'activity')

    expect(readStored('que.sidebarSort', (raw) => raw.toUpperCase(), 'NAME')).toBe('ACTIVITY')

    writeStored('que.sidebarSort', null)

    expect(localStorage.getItem('que.sidebarSort')).toBeNull()
    expect(readStored('que.sidebarSort', (raw) => raw.toUpperCase(), 'NAME')).toBe('NAME')
  })

  it('falls back when what is stored does not decode', () => {
    localStorage.setItem('que.review', '{not json')

    expect(readStored('que.review', (raw) => JSON.parse(raw) as { open: boolean }, null)).toBeNull()
  })
})
