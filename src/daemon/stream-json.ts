// Claude Code's `--output-format stream-json` output, read tolerantly: one
// JSON object per line, chunks split anywhere. Each line is decoded once
// (stream-json.decode.ts); unparsable or unrecognised lines are skipped and
// counted.
import { decodeStreamEvent, type StreamEvent } from './stream-json.decode'

export type { StreamEvent } from './stream-json.decode'

/** Splits stdout into decoded events. Feed chunks in arrival order. */
export class StreamParser {
  private buf = ''
  private decoder = new TextDecoder('utf-8')
  /** Lines that were not JSON, or did not decode to a stream event. */
  skipped = 0

  push(chunk: string | Uint8Array): StreamEvent[] {
    this.buf += chunk instanceof Uint8Array ? this.decoder.decode(chunk, { stream: true }) : chunk
    const lines = this.buf.split('\n')
    this.buf = lines.pop() ?? ''

    return this.parse(lines)
  }

  /** Parses a final line that never got its newline (call at end of stream). */
  flush(): StreamEvent[] {
    const rest = this.buf
    this.buf = ''

    return this.parse([rest])
  }

  /** Bytes after the last newline. */
  get pending(): string {
    return this.buf
  }

  private parse(lines: string[]): StreamEvent[] {
    const out: StreamEvent[] = []

    for (const line of lines) {
      if (line.trim() === '') continue
      let event: StreamEvent | null = null

      try {
        event = decodeStreamEvent(JSON.parse(line))
      } catch {
        // Not JSON: counted below.
      }

      if (event) out.push(event)
      else this.skipped += 1
    }

    return out
  }
}
