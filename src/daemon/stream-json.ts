// Claude Code's `--output-format stream-json` output, read tolerantly: one
// JSON object per line, chunks split anywhere, unparsable lines skipped and
// counted. The guards cover only the message kinds que acts on.
import type { StreamResult } from '../shared/protocol'

/** Any stream-json message: an object with a string `type`. */
export interface StreamMessage {
  type: string
  [key: string]: unknown
}

export interface SystemInit extends StreamMessage {
  type: 'system'
  subtype: 'init'
  session_id: string
}

export interface ApiRetry extends StreamMessage {
  type: 'system'
  subtype: 'api_retry'
  error_status?: number | null
  retry_delay_ms?: number
}

export interface RateLimitEvent extends StreamMessage {
  type: 'rate_limit_event'
  rate_limit_info: { status?: string; resetsAt?: number }
}

export type ResultMessage = StreamMessage & StreamResult

/** Splits stdout into messages. Feed chunks in arrival order. */
export class StreamParser {
  private buf = ''
  private decoder = new TextDecoder('utf-8')
  /** Lines that were not a JSON object with a string `type`. */
  skipped = 0

  push(chunk: string | Uint8Array): StreamMessage[] {
    this.buf += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
    const lines = this.buf.split('\n')
    this.buf = lines.pop() ?? ''
    return this.parse(lines)
  }

  /** Parses a final line that never got its newline (call at end of stream). */
  flush(): StreamMessage[] {
    const rest = this.buf
    this.buf = ''
    return this.parse([rest])
  }

  /** Bytes after the last newline. */
  get pending(): string {
    return this.buf
  }

  private parse(lines: string[]): StreamMessage[] {
    const out: StreamMessage[] = []
    for (const line of lines) {
      if (line.trim() === '') continue
      try {
        const v = JSON.parse(line) as unknown
        if (isObject(v) && typeof v.type === 'string') out.push(v as StreamMessage)
        else this.skipped += 1
      } catch {
        this.skipped += 1
      }
    }
    return out
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isInit(m: StreamMessage): m is SystemInit {
  return m.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string'
}

export function isApiRetry(m: StreamMessage): m is ApiRetry {
  return m.type === 'system' && m.subtype === 'api_retry'
}

export function isRateLimitEvent(m: StreamMessage): m is RateLimitEvent {
  return m.type === 'rate_limit_event' && isObject(m.rate_limit_info)
}

export function isResult(m: StreamMessage): m is ResultMessage {
  return m.type === 'result' && typeof m.subtype === 'string'
}

/** The text blocks of an `assistant` message joined, or null for anything else. */
export function assistantText(m: StreamMessage): string | null {
  if (m.type !== 'assistant' || !isObject(m.message)) return null
  const content = m.message.content
  if (!Array.isArray(content)) return null
  const texts = content
    .filter((b): b is { type: 'text'; text: string } => {
      return isObject(b) && b.type === 'text' && typeof b.text === 'string'
    })
    .map((b) => b.text)
  return texts.length > 0 ? texts.join('\n') : null
}
