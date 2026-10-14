// `que term attach` / `que attach`: raw-mode passthrough of this TTY to a
// daemon terminal. Ctrl-] detaches.
import { DaemonClient } from '../shared/client'

export async function attach(id: string): Promise<void> {
  const stdin = process.stdin
  const stdout = process.stdout
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error('que: attach needs an interactive terminal')
    process.exit(1)
  }
  const client = await DaemonClient.connectOrStart()
  const size = (): { cols: number; rows: number } => ({
    cols: stdout.columns || 80,
    rows: stdout.rows || 24
  })

  let finished = false
  let resolveDone!: () => void
  const done = new Promise<void>((r) => (resolveDone = r))
  const finish = (msg?: string): void => {
    if (finished) return
    finished = true
    process.off('SIGWINCH', onResize)
    stdin.off('data', onInput)
    try {
      stdin.setRawMode(false)
    } catch {
      // stdin already closed.
    }
    stdin.pause()
    // Reset attributes and show the cursor in case the program hid it.
    stdout.write('\x1b[0m\x1b[?25h\r\n')
    if (msg) stdout.write(`${msg}\r\n`)
    void client
      .request('term.detach', { id })
      .catch(() => {})
      .finally(() => {
        client.close()
        resolveDone()
      })
  }

  const onInput = (buf: Buffer): void => {
    const i = buf.indexOf(0x1d) // Ctrl-]
    if (i >= 0) {
      if (i > 0)
        void client.request('term.write', { id, data: buf.subarray(0, i).toString('utf8') })
      finish('[detached]')
      return
    }
    void client.request('term.write', { id, data: buf.toString('utf8') }).catch(() => {})
  }
  const onResize = (): void => {
    void client.request('term.resize', { id, ...size() }).catch(() => {})
  }

  client.on('term.data', (e) => {
    if (e.id === id) stdout.write(e.data)
  })
  client.on('term.exit', (e) => {
    if (e.id === id) finish(`[process exited with code ${e.exitCode}]`)
  })
  client.on('term.killed', (e) => {
    if (e.id === id) finish('[terminal killed]')
  })
  client.onClose(() => finish('[daemon connection closed]'))

  // Subscribe before switching the TTY so errors print normally.
  const res = await client.request('term.attach', { id, ...size() })
  stdin.setRawMode(true)
  stdin.resume()
  // Clear the screen, then replay the terminal's current state.
  stdout.write('\x1b[H\x1b[2J\x1b[3J')
  stdout.write(res.snapshot)
  stdin.on('data', onInput)
  process.on('SIGWINCH', onResize)
  await done
}
