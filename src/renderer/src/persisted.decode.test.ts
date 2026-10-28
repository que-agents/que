import { afterEach, describe, expect, it } from 'vitest'
import {
  decodeDiffBases,
  decodeDiffComments,
  decodeDiffMode,
  decodeDiffWhitespace,
  decodeLayout,
  decodeReview,
  readStored,
  writeStored
} from './persisted.decode'

describe('decodeReview', () => {
  it('reads back the review pane the store writes', () => {
    const stored = JSON.parse(
      '{"open":true,"width":412,' +
        '"places":{"ws_01hzx3k9c2qf":{"view":"prs","pr":188},"ws_01hzx4m1p8rt":{"view":"changes","pr":null}},' +
        '"seen":{"ws_01hzx3k9c2qf":{"187":"2026-10-14T03:00:00.000Z","188":"2026-10-14T03:20:00.000Z"}}}'
    )

    expect(decodeReview(stored)).toEqual({
      open: true,
      width: 412,
      places: {
        ws_01hzx3k9c2qf: { view: 'prs', pr: 188 },
        ws_01hzx4m1p8rt: { view: 'changes', pr: null }
      },
      seen: {
        ws_01hzx3k9c2qf: { 187: '2026-10-14T03:00:00.000Z', 188: '2026-10-14T03:20:00.000Z' }
      }
    })
  })

  it('nulls out fields of the wrong type and drops anything that is not an object', () => {
    expect(
      decodeReview({
        open: 'yes',
        width: '400',
        places: { ws_a: 'prs', ws_b: { view: 4, pr: '188' }, ws_c: { view: 'prs', pr: -1 } },
        seen: { ws_a: 'x', ws_b: { 188: '', x: '2026-10-14T03:00:00.000Z' }, ws_c: { 7: 'at' } }
      })
    ).toEqual({
      open: false,
      width: null,
      places: { ws_b: { view: null, pr: null }, ws_c: { view: 'prs', pr: null } },
      seen: { ws_c: { 7: 'at' } }
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

describe('decodeDiffComments', () => {
  it('reads back the per-project choices the store writes', () => {
    const stored = JSON.parse(
      '{"prj_01hzx2a7k4mn":{"mode":"fold","keepRemoved":false},"prj_01hzx2b8q5rs":{"mode":"show","keepRemoved":true}}'
    )

    expect(decodeDiffComments(stored)).toEqual({
      prj_01hzx2a7k4mn: { mode: 'fold', keepRemoved: false },
      prj_01hzx2b8q5rs: { mode: 'show', keepRemoved: true }
    })
  })

  it('drops unknown modes, keeps removed comments unless told not to, and ignores non-objects', () => {
    expect(
      decodeDiffComments({ a: { mode: 'hide' }, b: { mode: 'fold', keepRemoved: 'no' }, c: 'dim' })
    ).toEqual({ b: { mode: 'fold', keepRemoved: true } })
    expect(decodeDiffComments(['fold'])).toEqual({})
  })
})

describe('decodeDiffMode', () => {
  it('reads split, and unified for anything else', () => {
    expect(decodeDiffMode('split')).toBe('split')
    expect(decodeDiffMode('unified')).toBe('unified')
    expect(decodeDiffMode('side-by-side')).toBe('unified')
  })
})

describe('decodeDiffWhitespace', () => {
  it('reads ignore, and show for anything else', () => {
    expect(decodeDiffWhitespace('ignore')).toBe('ignore')
    expect(decodeDiffWhitespace('show')).toBe('show')
    expect(decodeDiffWhitespace('true')).toBe('show')
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
