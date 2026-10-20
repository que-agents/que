// What a handoff needs from a terminal's master fd beyond what node-pty
// offers: stop and restart reading it at the handle, write to it, and resize
// it and name its foreground process through node-pty's own native binding.
import fs from 'node:fs'
import type tty from 'node:tty'
import { errorCode } from '../shared/errors.decode'

interface PtyBinding {
  resize(fd: number, cols: number, rows: number): void
  /** The kernel's name of the foreground process on the master (darwin takes only the fd). */
  process(fd: number): string | undefined
}

/**
 * The kernel's name of the process group in the terminal's foreground, read on
 * the master fd; undefined when no group has the terminal (the binding then
 * answers `kernel_task`, pid 0: before the shell takes it and once it is gone)
 * or the fd is closed.
 */
export function foregroundProcess(fd: number): string | undefined {
  try {
    const name = ptyBinding().process(fd)

    return name && name !== 'kernel_task' ? name : undefined
  } catch {
    return undefined
  }
}

interface NativeLoader {
  loadNativeModule(name: string): { module: PtyBinding }
}

let binding: PtyBinding | null = null

/**
 * node-pty's native binding, loaded the way node-pty loads it (its
 * build/Release, then its prebuilds, next to its lib/), so it is the same
 * module node-pty uses, in the app bundle and in development.
 */
export function ptyBinding(): PtyBinding {
  if (!binding) {
    // A subpath of the external node-pty package, resolved at runtime.
    const loader: NativeLoader = require('node-pty/lib/utils')
    binding = loader.loadNativeModule('pty').module
  }

  return binding
}

/** The libuv handle under a stream, and the flag net reads to know whether it is reading. */
interface ReadHandle {
  reading: boolean
  readStop(): number
  readStart(): number
}

function handleOf(stream: tty.ReadStream): ReadHandle | null {
  return (stream as tty.ReadStream & { _handle?: ReadHandle | null })._handle ?? null
}

/**
 * Stops reading the fd and hands every byte already read to the stream's
 * 'data' listeners. Pausing alone only stops the stream flowing: the handle
 * keeps reading into the stream's buffer, and those bytes would never reach a
 * successor. With the handle stopped, later output waits in the kernel.
 * `reading` is left set so a read() from the buffer does not start it again.
 */
export function holdReading(stream: tty.ReadStream): void {
  stream.pause()
  const handle = handleOf(stream)

  if (handle) {
    handle.readStop()
    handle.reading = true
  }

  // read() emits what it returns as 'data'.
  let chunk = stream.read()

  while (chunk !== null) chunk = stream.read()
}

/** Undoes holdReading: the handle reads again and the stream flows. */
export function resumeReading(stream: tty.ReadStream): void {
  const handle = handleOf(stream)

  if (handle && !stream.destroyed) {
    handle.reading = true
    handle.readStart()
  }

  stream.resume()
}

/**
 * Writes to an fd in order, retrying on EAGAIN (the master is non-blocking),
 * as node-pty's own writer does.
 */
export class FdWriter {
  private queue: Array<{ buf: Buffer; off: number }> = []
  private closed = false

  constructor(private readonly fd: number) {}

  write(data: string): void {
    if (this.closed || data.length === 0) return
    this.queue.push({ buf: Buffer.from(data, 'utf8'), off: 0 })

    if (this.queue.length === 1) this.flush()
  }

  close(): void {
    this.closed = true
    this.queue = []
  }

  private flush(): void {
    const task = this.queue[0]

    if (!task || this.closed) return

    fs.write(this.fd, task.buf, task.off, (err, written) => {
      if (err) {
        if (errorCode(err) === 'EAGAIN') setImmediate(() => this.flush())
        else this.queue = []

        return
      }

      task.off += written

      if (task.off >= task.buf.byteLength) this.queue.shift()
      this.flush()
    })
  }
}
