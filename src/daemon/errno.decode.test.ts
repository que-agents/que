import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { errnoCode } from './errno.decode'

describe('errnoCode', () => {
  it('reads the code of a real filesystem error', () => {
    let thrown: unknown

    try {
      fs.readFileSync(join(os.tmpdir(), `que-missing-${process.pid}-${Date.now()}`))
    } catch (err) {
      thrown = err
    }

    expect(errnoCode(thrown)).toBe('ENOENT')
  })

  it('is null for errors without a string code and for non-errors', () => {
    expect(errnoCode(new Error('plain'))).toBeNull()
    expect(errnoCode({ code: 2 })).toBeNull()
    expect(errnoCode('ENOENT')).toBeNull()
    expect(errnoCode(null)).toBeNull()
  })
})
