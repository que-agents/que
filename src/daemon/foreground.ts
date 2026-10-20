// What a terminal reports about itself beyond its screen: the title its program
// last set and the name of the program in its foreground.
//
// The foreground program is found in two steps. A cheap native call on the
// master fd (tcgetpgrp + sysctl) names it as the kernel does, and is read on
// every title change and once a second; when that raw name changes, `ps` on the
// terminal's tty finds the foreground group's leader and its argv[0], the name
// a terminal app shows (the kernel's name can be a versioned file the launcher
// symlink points at).
import { run } from '../shared/exec'
import type { TermInfo } from '../shared/protocol'

const POLL_MS = 1000
const PS = '/bin/ps'
const PS_TIMEOUT_MS = 5000

/**
 * The display name of the foreground process group's leader, from the output
 * of `ps -ww -t <tty> -o pid=,pgid=,ucomm=,comm=`: the row whose pid is its
 * pgid and whose ucomm is the raw name, by the basename of its comm, without
 * the leading `-` of a login shell. Null when no row matches.
 */
export function foregroundName(psOutput: string, raw: string): string | null {
  for (const line of psOutput.split('\n')) {
    // ucomm may hold spaces, so it is matched as the raw name rather than split off.
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)

    if (!m || m[1] !== m[2] || !m[3].startsWith(raw)) continue
    const comm = m[3].slice(raw.length)

    if (!/^\s/.test(comm)) continue
    const base = comm.trim().split('/').pop() ?? ''
    const name = base.startsWith('-') ? base.slice(1) : base

    if (name) return name
  }

  return null
}

/** Where a terminal's facts come from, and where a change goes. */
export interface FactsSource {
  /** The shell's pid, to find the terminal's tty. */
  pid: number
  /** The kernel's name of the foreground program; undefined (or a throw) when unknown. */
  readRaw: () => string | undefined
  /** Called after title or process changed. */
  onChange: () => void
}

/** The title and foreground program of one terminal, kept current while it lives. */
export class TerminalFacts {
  title: string | undefined
  process: string | undefined
  private raw: string | undefined
  /** The raw name the current process name was resolved for. */
  private resolvedFor: string | undefined
  private resolving = false
  private tty: string | null | undefined
  private timer: NodeJS.Timeout | null = null
  private disposed = false

  constructor(
    private readonly source: FactsSource,
    carried: Pick<TermInfo, 'title' | 'process'> = {}
  ) {
    this.title = carried.title || undefined
    this.process = carried.process || undefined
  }

  /** Starts the once-a-second poll and reads the foreground program now. */
  start(): void {
    if (this.disposed || this.timer) return
    this.timer = setInterval(() => this.check(), POLL_MS)
    this.timer.unref()
    this.check()
  }

  /** The program set a title (OSC 0 or 2); empty clears it. */
  titleChanged(title: string): void {
    if (this.disposed) return
    const next = title || undefined

    if (next !== this.title) {
      this.title = next
      this.source.onChange()
    }

    // The program that just wrote the title is the one in the foreground.
    this.check()
  }

  /** The terminal ended: polling stops, the last process name stays. */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  dispose(): void {
    this.stop()
    this.disposed = true
  }

  private check(): void {
    if (this.disposed) return
    let raw: string | undefined

    try {
      raw = this.source.readRaw()
    } catch {
      return
    }

    // `kernel_task` is pid 0: no process group has the terminal yet (or any more).
    if (!raw || raw === 'kernel_task' || raw === this.raw) return
    this.raw = raw
    void this.resolve()
  }

  /** One resolve at a time; a raw change while one runs runs it again afterwards. */
  private async resolve(): Promise<void> {
    if (this.resolving) return
    this.resolving = true

    try {
      while (this.raw !== undefined && this.raw !== this.resolvedFor && !this.disposed) {
        const raw = this.raw
        const name = await this.displayName(raw)

        this.resolvedFor = raw

        if (this.disposed || this.raw !== raw) continue

        if (name !== this.process) {
          this.process = name
          this.source.onChange()
        }
      }
    } finally {
      this.resolving = false
    }
  }

  private async displayName(raw: string): Promise<string> {
    const tty = await this.ttyName()

    if (!tty) return raw

    const r = await run(PS, ['-ww', '-t', tty, '-o', 'pid=,pgid=,ucomm=,comm='], {
      timeoutMs: PS_TIMEOUT_MS
    })

    return (r.ok && foregroundName(r.stdout, raw)) || raw
  }

  /** The terminal's tty (`ttys016`), asked of `ps` once. */
  private async ttyName(): Promise<string | null> {
    if (this.tty !== undefined) return this.tty

    const r = await run(PS, ['-o', 'tty=', '-p', String(this.source.pid)], {
      timeoutMs: PS_TIMEOUT_MS
    })

    // A failed ask is asked again next time; a process without a tty says `??`.
    if (!r.ok) return null
    const name = r.stdout.trim()

    this.tty = name && !name.startsWith('?') ? name : null

    return this.tty
  }
}
