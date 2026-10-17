// The lifecycle a polling service shares: a timer that runs `tick` and, once it
// settles, schedules the next one; an abort signal for the subprocesses a tick
// starts; and the set of calls still running, so stop() can be drained.

export interface PollerOptions {
  /** The wait before the next tick, read each time one is scheduled. */
  intervalMs: () => number
  tick: () => Promise<void>
}

export class Poller {
  private timer: NodeJS.Timeout | null = null
  private halted = true
  private controller = new AbortController()
  private inflight = new Set<Promise<unknown>>()

  constructor(private readonly opts: PollerOptions) {}

  /** True before start() and after stop(). */
  get stopped(): boolean {
    return this.halted
  }

  /** Aborted by stop(); a fresh one after the next start(). */
  get signal(): AbortSignal {
    return this.controller.signal
  }

  /** Starts polling; the first tick runs after `firstMs` (else the interval). */
  start(firstMs?: number): void {
    if (this.controller.signal.aborted) this.controller = new AbortController()
    this.halted = false
    this.schedule(firstMs ?? this.opts.intervalMs())
  }

  stop(): void {
    this.halted = true
    this.controller.abort()

    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Counts `p` as running until it settles, for drain(). */
  track<T>(p: Promise<T>): Promise<T> {
    this.inflight.add(p)
    const done = () => this.inflight.delete(p)
    p.then(done, done)

    return p
  }

  /** Resolves once every call that was running when stop() was called has ended. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.inflight])
  }

  private schedule(ms: number): void {
    if (this.halted) return
    this.timer = setTimeout(() => {
      void this.opts.tick().finally(() => this.schedule(this.opts.intervalMs()))
    }, ms)
    this.timer.unref()
  }
}
