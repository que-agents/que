import { describe, expect, it } from 'vitest'
import { makeStreamResult } from '../testing/fixtures'
import { StreamParser, type StreamEvent } from './stream-json'

const SESSION = '5f0c1d2e-0000-4000-8000-9a8b7c6d5e4f'
const INIT = { type: 'system', subtype: 'init', session_id: SESSION }

describe('StreamParser', () => {
  it('keeps a partial line until its newline arrives', () => {
    const p = new StreamParser()
    const line = JSON.stringify(INIT)

    expect(p.push(line.slice(0, 17))).toEqual([])
    expect(p.push(`${line.slice(17)}\n{"type":"assi`)).toEqual([
      { kind: 'init', sessionId: SESSION }
    ])
    expect(p.push('stant","message":{"content":[{"type":"text","text":"done"}]}}\n')).toEqual([
      { kind: 'assistant', text: 'done' }
    ])
  })

  it('decodes multi-byte UTF-8 split across byte chunks', () => {
    const p = new StreamParser()

    const bytes = new TextEncoder().encode(
      `${JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'naïve – ✓' }] }
      })}\n`
    )

    const out: StreamEvent[] = []

    for (const b of bytes) out.push(...p.push(new Uint8Array([b])))

    expect(out).toEqual([{ kind: 'assistant', text: 'naïve – ✓' }])
  })

  it('skips and counts lines that do not decode to a stream event', () => {
    const p = new StreamParser()

    const out = p.push(
      `not json\n${JSON.stringify(INIT)}\n[1,2]\n{"no_type":true}\n\n{"type":"result"`
    )

    expect(out).toEqual([{ kind: 'init', sessionId: SESSION }])
    expect(p.skipped).toBe(3)
  })

  it('flush() parses a last line that never got its newline', () => {
    const p = new StreamParser()
    p.push(JSON.stringify(makeStreamResult()))

    expect(p.flush()).toMatchObject([{ kind: 'result', subtype: 'success', turns: 9 }])
    expect(p.flush()).toEqual([])
    expect(p.skipped).toBe(0)
  })
})
