import { describe, expect, it } from 'vitest'
import { decodeDiffBases, decodeLayout, decodeReview } from './persisted.decode'

describe('decodeReview', () => {
  it('reads back the review pane the store writes', () => {
    const stored = JSON.parse('{"open":true,"tab":"files","width":412}')

    expect(decodeReview(stored)).toEqual({ open: true, tab: 'files', width: 412 })
  })

  it('nulls out fields of the wrong type and drops anything that is not an object', () => {
    expect(decodeReview({ open: 'yes', tab: 3, width: '400' })).toEqual({
      open: false,
      tab: null,
      width: null
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
