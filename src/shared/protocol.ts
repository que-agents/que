// Wire protocol between the que daemon and its clients (Electron main, CLI).
// Newline-delimited JSON over a unix socket. Requests carry an id; responses
// echo it. Events are server-pushed and carry no id.

export const PROTOCOL_VERSION = 1

// ---- method types ---------------------------------------------------------

export interface PingResult {
  version: string
  pid: number
  startedAt: string
  nodeVersion: string
}

export interface TermCreateParams {
  cwd?: string
  cols: number
  rows: number
  name?: string
  /** Program to run instead of the login shell. */
  file?: string
  args?: string[]
}

export interface TermInfo {
  id: string
  name: string
  cwd: string
  cols: number
  rows: number
  pid: number
  alive: boolean
  createdAt: string
}

export interface TermIdParams {
  id: string
}

export interface TermAttachParams {
  id: string
  cols: number
  rows: number
}

export interface TermAttachResult {
  snapshot: string
  cols: number
  rows: number
}

export interface TermWriteParams {
  id: string
  data: string
}

export interface TermResizeParams {
  id: string
  cols: number
  rows: number
}

export interface TermSnapshotResult {
  /** Escape-sequence serialization suitable for writing into an xterm. */
  serialized: string
  /** Plain text of scrollback + screen, one line per row. */
  text: string
}

export interface Ok {
  ok: true
}

/** Maps each method name to its params and result types. */
export interface Methods {
  'daemon.ping': { params: Record<string, never> | undefined; result: PingResult }
  'daemon.shutdown': { params: Record<string, never> | undefined; result: Ok }
  'term.create': { params: TermCreateParams; result: { id: string } }
  'term.list': { params: Record<string, never> | undefined; result: TermInfo[] }
  'term.attach': { params: TermAttachParams; result: TermAttachResult }
  'term.detach': { params: TermIdParams; result: Ok }
  'term.write': { params: TermWriteParams; result: Ok }
  'term.resize': { params: TermResizeParams; result: Ok }
  'term.kill': { params: TermIdParams; result: Ok }
  'term.snapshot': { params: TermIdParams; result: TermSnapshotResult }
}

export type MethodName = keyof Methods
export type ParamsOf<M extends MethodName> = Methods[M]['params']
export type ResultOf<M extends MethodName> = Methods[M]['result']

// ---- event types ----------------------------------------------------------

export interface Events {
  'term.data': { id: string; data: string }
  'term.exit': { id: string; exitCode: number; signal?: number }
  'term.created': { id: string }
  'term.killed': { id: string }
}

export type EventName = keyof Events
export type EventData<E extends EventName> = Events[E]

// ---- envelopes ------------------------------------------------------------

export interface Request {
  id: number
  method: string
  params?: Record<string, unknown>
}

export interface ResponseError {
  code: string
  message: string
}

export type Response = { id: number; result: unknown } | { id: number; error: ResponseError }

export interface EventMessage {
  event: string
  data: Record<string, unknown>
}

export type ServerMessage = Response | EventMessage

export const ErrorCodes = {
  BadRequest: 'bad_request',
  UnknownMethod: 'unknown_method',
  NotFound: 'not_found',
  Internal: 'internal'
} as const

// ---- framing --------------------------------------------------------------

export function encode(msg: unknown): string {
  return `${JSON.stringify(msg)}\n`
}

/**
 * Splits a byte stream into complete lines. Feed it chunks in arrival order;
 * a partial trailing line is kept until its newline arrives.
 */
export class LineSplitter {
  private buf = ''

  push(chunk: string): string[] {
    this.buf += chunk
    const parts = this.buf.split('\n')
    this.buf = parts.pop() ?? ''
    return parts.filter((l) => l.trim().length > 0)
  }

  /** Bytes received after the last newline. */
  get pending(): string {
    return this.buf
  }
}

/** Decodes buffered chunks into parsed JSON messages; bad lines go to onError. */
export class MessageDecoder<T = unknown> {
  private lines = new LineSplitter()
  private decoder = new TextDecoder('utf-8')

  constructor(private onError?: (line: string, err: unknown) => void) {}

  push(chunk: string | Uint8Array): T[] {
    const text = typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
    const out: T[] = []
    for (const line of this.lines.push(text)) {
      try {
        out.push(JSON.parse(line) as T)
      } catch (err) {
        this.onError?.(line, err)
      }
    }
    return out
  }
}

export function isEvent(msg: ServerMessage): msg is EventMessage {
  return typeof (msg as EventMessage).event === 'string'
}

// ---- Claude Code payloads -------------------------------------------------
// Shapes que receives from Claude Code: hook JSON on stdin and the final
// stream-json `result` line of a headless run.

export type HookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Notification'
  | 'Stop'
  | 'StopFailure'
  | 'SubagentStop'
  | 'PreCompact'
  | 'SessionEnd'

export interface HookEvent {
  hook_event_name: HookEventName
  session_id: string
  cwd: string
  transcript_path: string
  permission_mode?: string
  /** SessionStart */
  source?: 'startup' | 'resume' | 'clear' | 'compact'
  /** UserPromptSubmit */
  prompt?: string
  prompt_id?: string
  /** PreToolUse / PostToolUse */
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_response?: unknown
  tool_use_id?: string
  /** Notification */
  notification_type?: string
  message?: string
  title?: string
  /** Stop */
  last_assistant_message?: string
  stop_hook_active?: boolean
  /** StopFailure */
  error?: string
  error_details?: string
  /** SessionEnd */
  reason?: string
}

export interface StreamResult {
  type: 'result'
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd'
  is_error: boolean
  num_turns: number
  total_cost_usd: number
  duration_ms: number
  session_id: string
  stop_reason: string | null
  result?: string
}
