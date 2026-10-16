import { describe, expect, it } from 'vitest'
import { errorCode, errorMessage } from './errors.decode'

// The bridge rethrows a daemon error reply as an Error carrying the reply's code.
function bridgeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

describe('errorMessage', () => {
  it("reads a bridge rejection's message", () => {
    expect(errorMessage(bridgeError('not_found', 'no workspace ws_01hzx3k9c2qf'))).toBe(
      'no workspace ws_01hzx3k9c2qf'
    )
  })

  it('writes any other rejection value as text', () => {
    expect(errorMessage('daemon not running')).toBe('daemon not running')
    expect(errorMessage(undefined)).toBe('undefined')
  })
})

describe('errorCode', () => {
  it("reads a bridge rejection's daemon code", () => {
    expect(errorCode(bridgeError('not_found', 'no file src/gone.ts'))).toBe('not_found')
  })

  it('is null for rejections without a string code', () => {
    expect(errorCode(new Error('socket closed'))).toBeNull()
    expect(errorCode({ code: 404 })).toBeNull()
    expect(errorCode('not_found')).toBeNull()
    expect(errorCode(null)).toBeNull()
  })
})
