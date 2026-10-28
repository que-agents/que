// Tokenizing off the main thread: one long-lived worker thread
// (highlight-worker.ts), started on first use, takes requests by id. The main
// thread pumps every terminal, so it never loads a grammar or tokenizes
// itself. A request that times out, or a worker that crashes or cannot start,
// answers plain tokens for that file instead of failing; a stuck or dead
// worker is replaced on the next request.
import { Worker } from 'node:worker_threads'
import { plainFile, type TokenizedFile } from './syntax'
import type { TokenizeRequest } from './highlight-worker'

/** How long one file may take, queueing included, before it is answered plain. */
export const TOKENIZE_TIMEOUT_MS = 5_000

export interface TokenizeResult extends TokenizedFile {
  /** True when the worker failed or timed out and the lines are plain because of it. */
  degraded: boolean
}

interface Pending {
  text: string
  /** The worker holding it; null when none could start. */
  worker: Worker | null
  resolve: (r: TokenizeResult) => void
  timer: NodeJS.Timeout
}

export interface TokenizerOptions {
  /** The worker bundle (highlight-worker.js). */
  script: string
  timeoutMs?: number
  log?: (msg: string) => void
}

export class Tokenizer {
  private worker: Worker | null = null
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private closed = false

  constructor(private readonly opts: TokenizerOptions) {}

  /** The file's tokens; never rejects. A file with no language never reaches the worker. */
  tokenizeFile(text: string, language: string | null): Promise<TokenizeResult> {
    if (language === null || text === '' || this.closed) {
      return Promise.resolve({ ...plainFile(text), degraded: false })
    }

    return new Promise((resolve) => {
      const id = this.nextId++
      const worker = this.ensureWorker()

      const timer = setTimeout(() => {
        this.opts.log?.(`tokenizer: timed out on a file; restarting the worker`)
        this.settle(id, null)
        // A worker past its time is stuck; whatever it still holds is answered plain.
        void this.stop(worker)
      }, this.opts.timeoutMs ?? TOKENIZE_TIMEOUT_MS)

      this.pending.set(id, { text, worker, resolve, timer })

      if (!worker) {
        this.settle(id, null)

        return
      }

      const req: TokenizeRequest = { id, text, language }
      worker.postMessage(req)
    })
  }

  /** Stops the worker; requests in flight are answered plain and later ones are plain too. */
  async close(): Promise<void> {
    this.closed = true
    await this.stop()
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker
    let worker: Worker

    try {
      worker = new Worker(this.opts.script)
    } catch (err) {
      this.opts.log?.(`tokenizer: worker failed to start: ${String(err)}`)

      return null
    }

    worker.unref()
    worker.on('message', (msg: { id: number; result: TokenizedFile }) => {
      this.settle(msg.id, msg.result)
    })
    worker.on('error', (err) => this.opts.log?.(`tokenizer: worker error: ${err.message}`))
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = null
      this.failOn(worker)
    })
    this.worker = worker

    return worker
  }

  private async stop(worker = this.worker): Promise<void> {
    if (!worker) return

    if (this.worker === worker) this.worker = null
    this.failOn(worker)
    await worker.terminate()
  }

  /** Answers plain every request the worker still held. */
  private failOn(worker: Worker): void {
    for (const [id, p] of [...this.pending]) if (p.worker === worker) this.settle(id, null)
  }

  /** Answers one request: with the worker's result, or plain when null. */
  private settle(id: number, result: TokenizedFile | null): void {
    const p = this.pending.get(id)

    if (!p) return
    this.pending.delete(id)
    clearTimeout(p.timer)
    p.resolve(result ? { ...result, degraded: false } : { ...plainFile(p.text), degraded: true })
  }
}
