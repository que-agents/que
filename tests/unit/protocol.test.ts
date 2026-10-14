import { describe, expect, it } from 'vitest'
import { LineSplitter, MessageDecoder, encode } from '../../src/shared/protocol'

describe('framing', () => {
  it('splits lines across arbitrary chunk boundaries', () => {
    const s = new LineSplitter()
    expect(s.push('{"a":')).toEqual([])
    expect(s.push('1}\n{"b"')).toEqual(['{"a":1}'])
    expect(s.pending).toBe('{"b"')
    expect(s.push(':2}\n\n{"c":3}\n')).toEqual(['{"b":2}', '{"c":3}'])
    expect(s.pending).toBe('')
  })

  it('decodes messages fed one byte at a time, including multi-byte UTF-8', () => {
    const msgs = [{ id: 1, method: 'term.write', params: { id: 'x', data: 'héllo ✓ 🚀' } }, { event: 'e', data: {} }]
    const bytes = new TextEncoder().encode(msgs.map(encode).join(''))
    const d = new MessageDecoder()
    const out: unknown[] = []
    for (const b of bytes) out.push(...d.push(new Uint8Array([b])))
    expect(out).toEqual(msgs)
  })

  it('reports malformed lines without dropping later ones', () => {
    const bad: string[] = []
    const d = new MessageDecoder((line) => bad.push(line))
    expect(d.push('not json\n{"ok":true}\n')).toEqual([{ ok: true }])
    expect(bad).toEqual(['not json'])
  })
})
