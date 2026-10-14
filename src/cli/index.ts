// que CLI. Runs under the system `node`; must not load native modules.
import fs from 'node:fs'
import { Command } from 'commander'
import { DaemonClient, DaemonError } from '../shared/client'
import { quePaths } from '../shared/paths'
import type { TermInfo } from '../shared/protocol'

declare const __QUE_VERSION__: string
const VERSION = typeof __QUE_VERSION__ === 'string' ? __QUE_VERSION__ : '0.0.0-dev'

async function withClient<T>(fn: (c: DaemonClient) => Promise<T>, start = true): Promise<T> {
  const client = start ? await DaemonClient.connectOrStart() : await DaemonClient.tryConnect()
  if (!client) {
    console.error('que: daemon is not running')
    process.exit(1)
  }
  try {
    return await fn(client)
  } finally {
    client.close()
  }
}

function printTerms(terms: TermInfo[]): void {
  if (terms.length === 0) {
    console.log('no terminals')
    return
  }
  const rows = terms.map((t) => [
    t.id,
    t.alive ? 'alive' : 'exited',
    String(t.pid),
    `${t.cols}x${t.rows}`,
    t.name,
    t.cwd
  ])
  const header = ['ID', 'STATE', 'PID', 'SIZE', 'NAME', 'CWD']
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const fmt = (r: string[]): string =>
    r
      .map((c, i) => c.padEnd(widths[i]))
      .join('  ')
      .trimEnd()
  console.log(fmt(header))
  for (const r of rows) console.log(fmt(r))
}

/** Raw-mode passthrough of this TTY to a daemon terminal. Ctrl-] detaches. */
async function attach(id: string): Promise<void> {
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

async function main(): Promise<void> {
  const program = new Command()
  program.name('que').description('que command-line interface').version(VERSION)

  const daemon = program.command('daemon').description('manage the background daemon')
  daemon
    .command('start')
    .description('start the daemon if it is not running')
    .action(() =>
      withClient(async (c) => {
        const info = await c.request('daemon.ping')
        console.log(`daemon running pid=${info.pid} version=${info.version}`)
      })
    )
  daemon
    .command('stop')
    .description('kill all terminals and stop the daemon')
    .action(async () => {
      const c = await DaemonClient.tryConnect()
      if (!c) {
        console.log('daemon not running')
        return
      }
      const { pid } = await c.request('daemon.ping')
      const closed = new Promise<void>((r) => c.onClose(r))
      await c.request('daemon.shutdown')
      await Promise.race([closed, new Promise((r) => setTimeout(r, 2000))])
      c.close()
      // Wait (briefly) for the process to actually exit.
      for (let i = 0; i < 30; i++) {
        try {
          process.kill(pid, 0)
        } catch {
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      console.log(`daemon stopped (pid ${pid})`)
    })
  daemon
    .command('status')
    .description('show whether the daemon is running')
    .action(async () => {
      const paths = quePaths()
      const c = await DaemonClient.tryConnect(paths)
      if (!c) {
        console.log(`daemon not running (socket ${paths.socket})`)
        process.exitCode = 3
        return
      }
      try {
        const info = await c.request('daemon.ping')
        const terms = await c.request('term.list')
        console.log(
          `daemon running pid=${info.pid} version=${info.version} node=${info.nodeVersion}`
        )
        console.log(`started ${info.startedAt}`)
        console.log(`socket ${paths.socket}`)
        console.log(
          `terminals ${terms.filter((t) => t.alive).length} alive / ${terms.length} total`
        )
      } finally {
        c.close()
      }
    })

  const term = program.command('term').description('manage terminals')
  term
    .command('list')
    .description('list terminals')
    .option('--json', 'print JSON')
    .action((opts: { json?: boolean }) =>
      withClient(async (c) => {
        const terms = await c.request('term.list')
        if (opts.json) console.log(JSON.stringify(terms, null, 2))
        else printTerms(terms)
      }, false)
    )
  term
    .command('new')
    .description('create a terminal running a login shell')
    .option('--cwd <dir>', 'working directory', process.cwd())
    .option('--name <name>', 'display name')
    .action((opts: { cwd: string; name?: string }) =>
      withClient(async (c) => {
        if (!fs.existsSync(opts.cwd)) throw new Error(`no such directory: ${opts.cwd}`)
        const cols = process.stdout.columns || 80
        const rows = process.stdout.rows || 24
        const { id } = await c.request('term.create', {
          cwd: opts.cwd,
          name: opts.name,
          cols,
          rows
        })
        console.log(id)
      })
    )
  term
    .command('snapshot <id>')
    .description('print the terminal screen and scrollback')
    .option('--serialized', 'print the escape-sequence serialization instead of plain text')
    .action((id: string, opts: { serialized?: boolean }) =>
      withClient(async (c) => {
        const snap = await c.request('term.snapshot', { id })
        process.stdout.write(`${opts.serialized ? snap.serialized : snap.text}\n`)
      }, false)
    )
  term
    .command('kill <id>')
    .description('kill a terminal')
    .action((id: string) =>
      withClient(async (c) => {
        await c.request('term.kill', { id })
        console.log(`killed ${id}`)
      }, false)
    )
  term
    .command('attach <id>')
    .description('attach this TTY to a terminal (Ctrl-] detaches)')
    .action((id: string) => attach(id))

  await program.parseAsync(process.argv)
}

main().catch((err) => {
  const msg = err instanceof DaemonError ? `${err.message} (${err.code})` : (err as Error).message
  console.error(`que: ${msg}`)
  process.exit(1)
})
