import { describe, expect, it } from 'vitest'
import { encode, LineSplitter, MessageDecoder } from './protocol'

describe('LineSplitter', () => {
  it('splits lines across arbitrary chunk boundaries', () => {
    const s = new LineSplitter()
    expect(s.push('{"id":1,"method":"term.')).toEqual([])
    expect(s.push('list"}\n{"id":2')).toEqual(['{"id":1,"method":"term.list"}'])
    expect(s.pending).toBe('{"id":2')
    expect(s.push(',"method":"daemon.ping"}\n\n{"id":3}\n')).toEqual([
      '{"id":2,"method":"daemon.ping"}',
      '{"id":3}'
    ])
    expect(s.pending).toBe('')
  })
})

describe('MessageDecoder', () => {
  it('decodes messages fed one byte at a time, including multi-byte UTF-8', () => {
    const msgs = [
      { id: 1, method: 'term.write', params: { id: 'term_7f3a', data: 'héllo ✓ 🚀' } },
      { event: 'term.created', data: { id: 'term_7f3a' } }
    ]

    const bytes = new TextEncoder().encode(msgs.map(encode).join(''))
    const decoder = new MessageDecoder()
    const out: unknown[] = []

    for (const b of bytes) out.push(...decoder.push(new Uint8Array([b])))
    expect(out).toEqual(msgs)
  })

  it('reports malformed lines without dropping the good ones around them', () => {
    const bad: string[] = []
    const decoder = new MessageDecoder((line) => bad.push(line))
    expect(decoder.push('{"id":1}\nnot json\n{"ok":true}\n')).toEqual([{ id: 1 }, { ok: true }])
    expect(bad).toEqual(['not json'])
  })
})

describe('encode', () => {
  it('frames one message as a single newline-terminated JSON line', () => {
    const line = encode({ id: 7, method: 'term.write', params: { id: 'term_7f3a', data: 'a\nb' } })
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
    expect(JSON.parse(line)).toEqual({
      id: 7,
      method: 'term.write',
      params: { id: 'term_7f3a', data: 'a\nb' }
    })
  })
})
