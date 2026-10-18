// Sidebar titles that say what a session is doing. One background worker asks
// a small model (`claude -p --model <summary_model> --output-format text`, no
// tools, no saved session) for a short label from the brief and the session's latest assistant text, one
// call at a time, queued per workspace and throttled to one call per
// `summary_interval_minutes` after each completed turn. A title the user set
// (an explicit title or a rename) is never touched.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { titleOf } from '../shared/brief'
import type { UserConfig } from '../shared/config'
import { cleanSpawnEnv } from '../shared/env'
import { errorMessage } from '../shared/errors.decode'
import { firstLine, run } from '../shared/exec'
import type { QuePaths } from '../shared/paths'
import type { Workspace } from '../shared/types'
import { resolveClaude } from './runner'
import type { EventBus, Emit } from './bus'
import type { Store } from './store'
import { decodeAssistantText } from './transcript.decode'

export const SUMMARY_INSTRUCTION =
  'You label coding sessions. Reply with one label of three to eight words describing what this session is doing. No quotes, no trailing punctuation, nothing else.'

/** How much of the latest assistant text goes into the prompt (from its end). */
export const TAIL_CHARS = 1_500

/** How much of the brief goes into the prompt (from its start). */
export const BRIEF_CHARS = 4_096

/** How much of the transcript file is read (from its end) to find the latest assistant entry. */
export const TRANSCRIPT_TAIL_BYTES = 256 * 1024

/** A summary call is stopped after this long. */
export const SUMMARY_TIMEOUT_MS = 60_000

/** Output past this many bytes stops the call: a label is a line. */
const SUMMARY_MAX_BUFFER = 64 * 1024
const MAX_TITLE = 80

// ---- pure rules ---------------------------------------------------------------

/**
 * The last assistant entry's text in a transcript (JSON lines), at most `max`
 * characters from its end; null when there is none. Malformed lines are skipped.
 */
export function transcriptTail(jsonl: string, max = TAIL_CHARS): string | null {
  const lines = jsonl.split('\n')

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    const text = line ? decodeAssistantText(line) : null

    if (!text) continue

    return text.length > max ? text.slice(text.length - max) : text
  }

  return null
}

/**
 * The latest assistant text in the transcript file at `path`, reading at most its last
 * `bytes` (a partial first line is dropped); null when there is none. Throws when the
 * file cannot be read.
 */
export async function readTranscriptTail(
  path: string,
  bytes = TRANSCRIPT_TAIL_BYTES
): Promise<string | null> {
  const file = await fs.promises.open(path, 'r')

  try {
    const { size } = await file.stat()
    const start = Math.max(0, size - bytes)
    const buffer = Buffer.alloc(size - start)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start)
    let text = buffer.subarray(0, bytesRead).toString('utf8')

    // The window may open mid-line: parse from the first complete one.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1)

    return transcriptTail(text)
  } finally {
    await file.close()
  }
}

/**
 * The prompt: the fixed instruction, the brief (its first BRIEF_CHARS characters), and
 * the latest progress when there is any.
 */
export function buildSummaryPrompt(brief: string, tail: string | null): string {
  const trimmed = brief.trim()
  const capped = trimmed.length > BRIEF_CHARS ? trimmed.slice(0, BRIEF_CHARS).trimEnd() : trimmed
  const parts = [SUMMARY_INSTRUCTION, `Brief:\n${capped}`]

  if (tail?.trim()) parts.push(`Latest progress:\n${tail.trim()}`)

  return parts.join('\n\n')
}

/**
 * The model's reply as a title: its first non-empty line, without surrounding
 * quotes or trailing punctuation, at most 80 characters; null when nothing is left.
 */
export function sanitizeSummary(output: string): string | null {
  let line = output.split('\n').find((l) => l.trim() !== '') ?? ''
  line = line.trim()

  for (;;) {
    const before = line
    line = line.replace(/^["'`“”‘’*_]+|["'`“”‘’*_]+$/gu, '').trim()
    line = line.replace(/[.,;:!?…]+$/u, '').trim()

    if (line === before) break
  }

  if (line.length > MAX_TITLE) line = line.slice(0, MAX_TITLE).trimEnd()

  return line === '' ? null : line
}

/**
 * Whether a workspace's title may be replaced by a summary: it has a brief, is
 * not archived, and its title came from the brief or an earlier summary (a row
 * from before title sources were recorded counts when its title is the brief's
 * first line).
 */
export function summarisable(ws: Workspace): boolean {
  if (ws.archivedAt || !ws.brief?.trim()) return false

  if (ws.titleSource === 'user') return false

  if (ws.titleSource === 'brief' || ws.titleSource === 'summary') return true

  return ws.title === titleOf(ws.brief)
}

/** What to do with a request to summarise a workspace. */
export type ThrottleDecision =
  /** Queue it now. */
  | { kind: 'now' }
  /** Too soon: one refresh is now pending, due at `at` (ms). */
  | { kind: 'later'; at: number }
  /** A refresh is already pending (or will follow the call in flight); nothing more to do. */
  | { kind: 'pending' }

interface ThrottleEntry {
  lastDoneAt: number | null
  busy: boolean
  pending: boolean
  /** A hash of the prompt the last answered call was sent. */
  lastInput: string | null
}

const inputHash = (prompt: string): string => createHash('sha256').update(prompt).digest('hex')

/**
 * The per-workspace throttle: at most one call per interval after the last
 * completed one; a request inside the interval leaves one refresh pending.
 * It also remembers the input of the last answered call, so a call whose
 * prompt has not changed is skipped (and does not count as a call).
 * Time comes from the injected clock; the caller owns the timers.
 */
export class SummaryThrottle {
  private entries = new Map<string, ThrottleEntry>()

  constructor(
    private intervalMs: () => number,
    private now: () => number = Date.now
  ) {}

  private entry(id: string): ThrottleEntry {
    let e = this.entries.get(id)

    if (!e) {
      e = { lastDoneAt: null, busy: false, pending: false, lastInput: null }
      this.entries.set(id, e)
    }

    return e
  }

  request(id: string): ThrottleDecision {
    const e = this.entry(id)

    if (e.pending) return { kind: 'pending' }

    if (e.busy) {
      e.pending = true

      return { kind: 'pending' }
    }

    if (e.lastDoneAt !== null && this.now() - e.lastDoneAt < this.intervalMs()) {
      e.pending = true

      return { kind: 'later', at: e.lastDoneAt + this.intervalMs() }
    }

    return { kind: 'now' }
  }

  /** A call started. */
  begin(id: string): void {
    this.entry(id).busy = true
  }

  /** True when `prompt` is what the last answered call was sent: the call would repeat it. */
  unchanged(id: string, prompt: string): boolean {
    return this.entry(id).lastInput === inputHash(prompt)
  }

  /**
   * A call ended; `answered` is the prompt of a call that got a reply (remembered for
   * unchanged()). When a refresh is pending, the time it is due (ms), else null.
   */
  done(id: string, answered?: string): number | null {
    const e = this.entry(id)
    e.busy = false
    e.lastDoneAt = this.now()

    if (answered !== undefined) e.lastInput = inputHash(answered)

    return e.pending ? e.lastDoneAt + this.intervalMs() : null
  }

  /**
   * A run made no call (unchanged input, or nothing to summarise): the last call's time
   * stands. When a refresh is pending, the time it is due (ms), else null.
   */
  skipped(id: string): number | null {
    const e = this.entry(id)
    e.busy = false

    if (!e.pending) return null

    return (e.lastDoneAt ?? this.now()) + this.intervalMs()
  }

  /** The pending refresh's time has come: it is queued now. */
  due(id: string): void {
    this.entry(id).pending = false
  }

  forget(id: string): void {
    this.entries.delete(id)
  }
}

// ---- the service ---------------------------------------------------------------

export interface SummarizerOptions {
  store: Store
  paths: QuePaths
  emit: Emit
  /** The daemon's bus: a created workspace is queued, a removed one is dropped. */
  bus: EventBus
  config: () => UserConfig
  /** The transcript the status engine last saw for a workspace's session. */
  transcriptPath: (id: string) => string | undefined
  log?: (msg: string) => void
  now?: () => number
  /** How long a call may run before it is stopped. Default SUMMARY_TIMEOUT_MS. */
  timeoutMs?: number
}

/** Why a call in flight was stopped early. */
type StopReason = 'timeout' | 'shutdown' | 'removed'

/** What one queued run did: whether claude was called, and the prompt it answered. */
interface SummaryOutcome {
  called: boolean
  answered?: string
}

export class Summarizer {
  private queue: string[] = []
  private running: { id: string; abort: AbortController } | null = null
  private timers = new Map<string, NodeJS.Timeout>()
  private closed = false
  private readonly throttle: SummaryThrottle
  private idleWaiters: Array<() => void> = []

  constructor(private opts: SummarizerOptions) {
    this.throttle = new SummaryThrottle(
      () => opts.config().summaryIntervalMinutes * 60_000,
      opts.now ?? Date.now
    )
    opts.bus.on('workspace.created', (ws) => this.created(ws))
    opts.bus.on('workspace.removed', ({ id }) => this.forget(id))
  }

  private log(msg: string): void {
    this.opts.log?.(msg)
  }

  private eligible(id: string): Workspace | null {
    if (this.closed || !this.opts.config().summaries) return null
    const ws = this.opts.store.getWorkspace(id)

    return ws && summarisable(ws) ? ws : null
  }

  /** A workspace was created: one made from a brief is summarised at once. */
  created(ws: Workspace): void {
    if (ws.titleSource === 'brief') this.request(ws.id)
  }

  /** A session in the workspace completed a turn (its Stop hook). */
  stopped(id: string): void {
    this.request(id)
  }

  private request(id: string): void {
    if (!this.eligible(id)) return
    const d = this.throttle.request(id)

    if (d.kind === 'now') this.enqueue(id)
    else if (d.kind === 'later') this.schedule(id, d.at)
  }

  private schedule(id: string, at: number): void {
    if (this.closed || this.timers.has(id)) return
    const now = (this.opts.now ?? Date.now)()

    const timer = setTimeout(
      () => {
        this.timers.delete(id)
        this.throttle.due(id)

        if (this.eligible(id)) this.enqueue(id)
      },
      Math.max(0, at - now)
    )

    timer.unref()
    this.timers.set(id, timer)
  }

  private enqueue(id: string): void {
    if (this.closed || this.queue.includes(id)) return
    this.queue.push(id)
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.running) return

    while (!this.closed) {
      const id = this.queue.shift()

      if (id === undefined) break
      this.throttle.begin(id)
      const abort = new AbortController()
      this.running = { id, abort }
      let outcome: SummaryOutcome = { called: false }

      try {
        outcome = await this.summarise(id)
      } catch (err) {
        outcome = { called: true }
        this.log(`summary for ${id} failed: ${errorMessage(err)}`)
      }

      this.running = null

      // Removed while the call ran: forget() already dropped its throttle state.
      if (abort.signal.reason === 'removed') continue

      const due = outcome.called
        ? this.throttle.done(id, outcome.answered)
        : this.throttle.skipped(id)

      if (due !== null) this.schedule(id, due)
    }

    for (const w of this.idleWaiters.splice(0)) w()
  }

  private async summarise(id: string): Promise<SummaryOutcome> {
    const ws = this.eligible(id)

    if (!ws?.brief) return { called: false }
    const transcript = this.opts.transcriptPath(id)
    let tail: string | null = null

    if (transcript) {
      try {
        tail = await readTranscriptTail(transcript)
      } catch {
        // No transcript (yet): the brief alone.
      }
    }

    const prompt = buildSummaryPrompt(ws.brief, tail)

    if (this.throttle.unchanged(id, prompt)) {
      this.log(`summary for ${id}: input unchanged; skipped`)

      return { called: false }
    }

    const reply = await this.ask(id, prompt)

    if (reply === null) return { called: true }
    const done: SummaryOutcome = { called: true, answered: prompt }
    const title = sanitizeSummary(reply)

    if (title === null) {
      this.log(`summary for ${id}: empty reply; title kept`)

      return done
    }

    // Re-read: a rename or removal while the call ran wins.
    const now = this.eligible(id)

    if (!now) return done

    // The same title still counts as a summary, so a brief title is not asked about again.
    if (now.title === title && now.titleSource === 'summary') return done
    this.opts.store.setWorkspaceTitle(id, title, 'summary')
    const next = this.opts.store.getWorkspace(id)
    this.log(`workspace ${id} summarised as ${JSON.stringify(title)}`)

    if (next) this.opts.emit('workspace.updated', next)

    return done
  }

  /**
   * Runs claude headless from QUE_HOME with no tools and no saved session; its stdout, or
   * null on any failure. The call in flight is stopped by its timeout, close() or forget().
   */
  private async ask(id: string, prompt: string): Promise<string | null> {
    const abort = this.running?.id === id ? this.running.abort : null

    if (this.closed || !abort || abort.signal.aborted) return null
    const claude = resolveClaude(this.opts.paths)

    if (!claude) {
      this.log(`summary for ${id}: claude was not found on PATH`)

      return null
    }

    const env = cleanSpawnEnv(process.env)
    // Not a workspace session: no que hooks, no task.
    delete env.QUE_WORKSPACE_ID
    delete env.QUE_TASK_ID
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    const model = this.opts.config().summaryModel
    const timeoutMs = this.opts.timeoutMs ?? SUMMARY_TIMEOUT_MS
    // An abort, unlike execFile's own timeout, settles without waiting for the child to exit.
    const timer = setTimeout(() => abort.abort('timeout' satisfies StopReason), timeoutMs)

    const args = [
      '-p',
      prompt,
      '--model',
      model,
      '--output-format',
      'text',
      '--tools',
      '',
      '--no-session-persistence'
    ]

    const r = await run(claude, args, {
      cwd: this.opts.paths.home,
      env,
      signal: abort.signal,
      maxBuffer: SUMMARY_MAX_BUFFER
    }).finally(() => clearTimeout(timer))

    if (r.ok) return r.stdout

    if (abort.signal.reason === 'timeout') {
      this.log(`summary for ${id}: no answer in ${timeoutMs / 1000}s; stopped`)
    } else if (abort.signal.aborted) {
      this.log(`summary for ${id}: stopped (${String(abort.signal.reason)})`)
    } else {
      const detail = firstLine(r.stderr) || firstLine(r.error)

      this.log(`summary for ${id}: claude failed: ${detail.slice(0, 200)}`)
    }

    return null
  }

  /** The workspace was archived or removed: nothing more for it. */
  forget(id: string): void {
    const timer = this.timers.get(id)

    if (timer) clearTimeout(timer)
    this.timers.delete(id)
    this.queue = this.queue.filter((q) => q !== id)
    this.throttle.forget(id)

    if (this.running?.id === id) this.running.abort.abort('removed' satisfies StopReason)
  }

  /**
   * Daemon shutdown: timers cleared, the queue dropped, a call in flight aborted. Resolves
   * once the worker is idle, which an abort makes immediate even if the child lingers.
   */
  async close(): Promise<void> {
    this.closed = true

    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    this.queue = []

    if (!this.running) return
    const idle = new Promise<void>((resolve) => this.idleWaiters.push(resolve))

    this.running.abort.abort('shutdown' satisfies StopReason)
    await idle
  }
}
