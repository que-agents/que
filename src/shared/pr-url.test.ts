import { describe, expect, it } from 'vitest'
import { prUrlNumber } from './pr-url'

describe('prUrlNumber', () => {
  it.each([
    ['https://github.com/rquellh/que/pull/88', 88],
    ['https://github.com/rquellh/que/pull/88/', 88],
    ['https://github.com/rquellh/que/issues/88', null],
    ['https://github.com/rquellh/que/pull/', null],
    ['', null],
    [null, null],
    [undefined, null]
  ])('reads %j as %j', (url, n) => {
    expect(prUrlNumber(url)).toBe(n)
  })
})
