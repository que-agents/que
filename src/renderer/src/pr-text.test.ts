import { describe, expect, it } from 'vitest'
import { splitFences } from './pr-text'

describe('splitFences', () => {
  describe('text', () => {
    it('keeps a body without fences as one text part, line breaks and all', () => {
      expect(splitFences('Looks good.\n\nOne question:\nwhy 3?')).toEqual([
        { kind: 'text', text: 'Looks good.\n\nOne question:\nwhy 3?' }
      ])
    })

    it('returns nothing for an empty body', () => {
      expect(splitFences('')).toEqual([])
      expect(splitFences('\n  \n')).toEqual([])
    })
  })

  describe('fences', () => {
    it('splits text, a fenced block with its language, and the text after it', () => {
      const body = 'Try this:\n```ts\nconst retries = 3\nawait put()\n```\nThen rerun.'

      expect(splitFences(body)).toEqual([
        { kind: 'text', text: 'Try this:' },
        { kind: 'code', text: 'const retries = 3\nawait put()', lang: 'ts' },
        { kind: 'text', text: 'Then rerun.' }
      ])
    })

    it('handles a body that is only a fence, and two fences in a row', () => {
      expect(splitFences('```\na\n```\n```sh\nb\n```')).toEqual([
        { kind: 'code', text: 'a', lang: '' },
        { kind: 'code', text: 'b', lang: 'sh' }
      ])
    })

    it('runs an unclosed fence to the end', () => {
      expect(splitFences('See:\n```\nline 1\nline 2')).toEqual([
        { kind: 'text', text: 'See:' },
        { kind: 'code', text: 'line 1\nline 2', lang: '' }
      ])
    })

    it('reads CRLF bodies like LF ones', () => {
      expect(splitFences('a\r\n```\r\nb\r\n```')).toEqual([
        { kind: 'text', text: 'a' },
        { kind: 'code', text: 'b', lang: '' }
      ])
    })
  })
})
