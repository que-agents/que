// Claude Code's `--output-format stream-json` output, read tolerantly: one
// JSON object per line, chunks split anywhere. Each line is decoded once
// (stream-json.decode.ts); unparsable or unrecognised lines are skipped and
// counted.
import { MessageDecoder } from '../shared/protocol'
import { decodeStreamEvent, type StreamEvent } from './stream-json.decode'

export type { StreamEvent } from './stream-json.decode'

/** Splits stdout into decoded events. Feed chunks in arrival order. */
export class StreamParser {
  /** Lines that were not JSON, or did not decode to a stream event. */
  skipped = 0
  private messages = new MessageDecoder(() => {
    this.skipped += 1
  })

  push(chunk: string | Uint8Array): StreamEvent[] {
    return this.decode(this.messages.push(chunk))
  }

  /** Parses a final line that never got its newline (call at end of stream). */
  flush(): StreamEvent[] {
    return this.decode(this.messages.flush())
  }

  private decode(values: unknown[]): StreamEvent[] {
    const out: StreamEvent[] = []

    for (const v of values) {
      const event = decodeStreamEvent(v)

      if (event) out.push(event)
      else this.skipped += 1
    }

    return out
  }
}
