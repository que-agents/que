import { describe, expect, it } from 'vitest'
import { makeStreamResult } from '../testing/fixtures'
import {
  assistantText,
  isApiRetry,
  isInit,
  isRateLimitEvent,
  isResult,
  StreamParser,
  type StreamMessage
} from './stream-json'

const INIT = { type: 'system', subtype: 'init', session_id: '5f0c1d2e-0000-4000-8000-9a8b7c6d5e4f' }

describe('StreamParser', () => {
  it('keeps a partial line until its newline arrives', () => {
    const p = new StreamParser()
    const line = JSON.stringify(INIT)

    expect(p.push(line.slice(0, 17))).toEqual([])
    expect(p.push(`${line.slice(17)}\n{"type":"assi`)).toEqual([INIT])
    expect(p.pending).toBe('{"type":"assi')
  })

  it('decodes multi-byte UTF-8 split across byte chunks', () => {
    const p = new StreamParser()
    const bytes = new TextEncoder().encode(
      `${JSON.stringify({ type: 'assistant', note: 'naïve – ✓' })}\n`
    )
    const out: StreamMessage[] = []

    for (const b of bytes) out.push(...p.push(new Uint8Array([b])))

    expect(out).toEqual([{ type: 'assistant', note: 'naïve – ✓' }])
  })

  it('skips and counts lines that are not JSON objects with a type', () => {
    const p = new StreamParser()

    const out = p.push(
      `not json\n${JSON.stringify(INIT)}\n[1,2]\n{"no_type":true}\n\n{"type":"result"`
    )

    expect(out).toEqual([INIT])
    expect(p.skipped).toBe(3)
  })

  it('flush() parses a last line that never got its newline', () => {
    const p = new StreamParser()
    p.push(JSON.stringify(makeStreamResult()))

    expect(p.flush()).toEqual([makeStreamResult()])
    expect(p.pending).toBe('')
  })
})

describe('guards', () => {
  it('recognises the init message only with a session id', () => {
    expect(isInit(INIT)).toBe(true)
    expect(isInit({ type: 'system', subtype: 'init' })).toBe(false)
    expect(isInit({ type: 'system', subtype: 'api_retry' })).toBe(false)
  })

  it('recognises api_retry and rate_limit_event', () => {
    expect(isApiRetry({ type: 'system', subtype: 'api_retry', error_status: 429 })).toBe(true)
    expect(
      isRateLimitEvent({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } })
    ).toBe(true)
    expect(isRateLimitEvent({ type: 'rate_limit_event' })).toBe(false)
  })

  it('recognises a result of any subtype', () => {
    expect(isResult(makeStreamResult({ subtype: 'error_max_turns' }))).toBe(true)
    expect(isResult({ type: 'result' })).toBe(false)
  })

  it('joins the text blocks of an assistant message, skipping tool calls', () => {
    const m = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: "I'll make that change now." },
          { type: 'tool_use', id: 'toolu_01', name: 'Write', input: {} },
          { type: 'text', text: 'Done.' }
        ]
      }
    }

    expect(assistantText(m)).toBe("I'll make that change now.\nDone.")
    expect(
      assistantText({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } })
    ).toBeNull()
    expect(assistantText(INIT)).toBeNull()
  })
})
