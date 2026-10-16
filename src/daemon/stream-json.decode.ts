// Decodes one parsed line of Claude Code's `--output-format stream-json`
// output into the events the task machine acts on. The stream's own field
// names stay in this file; everything past it reads the domain names below.

/** One stream-json line, decoded. */
export type StreamEvent =
  /** `system`/`init`: the session started. */
  | { kind: 'init'; sessionId: string }
  /** An assistant turn: its text blocks joined, or null when it only called tools. */
  | { kind: 'assistant'; text: string | null }
  /** The final line of a run. */
  | {
      kind: 'result'
      subtype: string
      costUsd?: number
      turns?: number
      sessionId?: string
      /** The final answer, when it is not empty. */
      text?: string
      /** The session could not start (for example, the worktree was refused). */
      startupFailed: boolean
    }
  /** `system`/`api_retry`: the API call failed and is being retried. */
  | { kind: 'api_retry'; httpStatus: number | null; retryDelayMs: number | null }
  /** `rate_limit_event`: the account's rate-limit state; `resetsAt` in epoch ms. */
  | { kind: 'rate_limit'; status: string | null; resetsAt: number | null }
  /** Any other well-formed line: still a sign the run is alive. */
  | { kind: 'other'; type: string }

type Obj = { [key: string]: unknown }

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

function decodeSystem(v: Obj): StreamEvent | null {
  switch (v.subtype) {
    case 'init': {
      const sessionId = str(v.session_id)

      return sessionId === undefined ? null : { kind: 'init', sessionId }
    }

    case 'api_retry':
      return {
        kind: 'api_retry',
        httpStatus: num(v.error_status) ?? null,
        retryDelayMs: num(v.retry_delay_ms) ?? null
      }
    default:
      return { kind: 'other', type: 'system' }
  }
}

function decodeAssistant(v: Obj): StreamEvent | null {
  if (!isObject(v.message) || !Array.isArray(v.message.content)) return null
  const texts: string[] = []

  for (const block of v.message.content) {
    if (isObject(block) && block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text)
    }
  }

  return { kind: 'assistant', text: texts.length > 0 ? texts.join('\n') : null }
}

function decodeResult(v: Obj): StreamEvent | null {
  const subtype = str(v.subtype)

  if (subtype === undefined) return null
  const text = str(v.result)

  return {
    kind: 'result',
    subtype,
    costUsd: num(v.total_cost_usd),
    turns: num(v.num_turns),
    sessionId: str(v.session_id),
    text: text ? text : undefined,
    startupFailed: Boolean(v.startup_failure_reason)
  }
}

function decodeRateLimit(v: Obj): StreamEvent | null {
  if (!isObject(v.rate_limit_info)) return null
  const resetsAt = num(v.rate_limit_info.resetsAt)

  return {
    kind: 'rate_limit',
    status: str(v.rate_limit_info.status) ?? null,
    resetsAt: resetsAt === undefined ? null : resetsAt * 1000
  }
}

/**
 * One parsed stream-json line as a `StreamEvent`, or null when it is not an
 * object with a string `type`, or is a kind que reads but malformed.
 */
export function decodeStreamEvent(v: unknown): StreamEvent | null {
  if (!isObject(v) || typeof v.type !== 'string') return null

  switch (v.type) {
    case 'system':
      return decodeSystem(v)
    case 'assistant':
      return decodeAssistant(v)
    case 'result':
      return decodeResult(v)
    case 'rate_limit_event':
      return decodeRateLimit(v)
    default:
      return { kind: 'other', type: v.type }
  }
}
