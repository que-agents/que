// que daemon: owns every PTY so terminals survive app restarts. Runs under the
// Electron binary as plain Node (ELECTRON_RUN_AS_NODE=1).
import fs from 'node:fs'
import net from 'node:net'
import { ensureDirs, quePaths } from '../shared/paths'
import { PtyHost } from './pty-host'
import { DaemonServer } from './server'

declare const __QUE_VERSION__: string

// oxlint-disable-next-line anti-slop/no-runtime-typeof -- build-time define, absent when run unbundled
const VERSION = typeof __QUE_VERSION__ === 'string' ? __QUE_VERSION__ : '0.0.0-dev'

const paths = ensureDirs(quePaths())
const logStream = fs.createWriteStream(paths.daemonLog, { flags: 'a' })

function log(msg: string): void {
  logStream.write(`${new Date().toISOString()} [${process.pid}] ${msg}\n`)
}

/** True if something is accepting connections on the socket. */
function socketAlive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(path)
    s.once('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.once('error', () => resolve(false))
  })
}

async function main(): Promise<void> {
  if (paths.socketFallback) log(`socket path too long; using ${paths.socket}`)

  if (fs.existsSync(paths.socket)) {
    if (await socketAlive(paths.socket)) {
      // Not a failure: under launchd (KeepAlive on unsuccessful exit) this
      // must not be restarted in a loop.
      log('another daemon is already listening; exiting')
      process.exitCode = 0
      logStream.end()

      return
    }

    fs.rmSync(paths.socket, { force: true })
    log('removed stale socket')
  }

  const host = new PtyHost()
  let shuttingDown = false

  const shutdown = (reason: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    log(`shutting down (${reason})`)
    host.killAll()
    void server.close().finally(() => {
      fs.rmSync(paths.socket, { force: true })

      try {
        if (fs.readFileSync(paths.pid, 'utf8').trim() === String(process.pid)) fs.rmSync(paths.pid)
      } catch {
        // Pid file already gone.
      }

      logStream.end(() => process.exit(0))
      setTimeout(() => process.exit(0), 1000).unref()
    })
  }

  const server = new DaemonServer({
    host,
    version: VERSION,
    log,
    onShutdown: () => shutdown('daemon.shutdown')
  })

  await server.listen(paths.socket)
  fs.writeFileSync(paths.pid, `${process.pid}\n`)
  log(`listening on ${paths.socket} (version ${VERSION}, node ${process.version})`)

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  // Detached from any terminal; ignore hangups from a parent session.
  process.on('SIGHUP', () => log('ignoring SIGHUP'))
  process.on('uncaughtException', (err) => log(`uncaught: ${err.stack ?? err.message}`))
  process.on('unhandledRejection', (err) => log(`unhandled rejection: ${String(err)}`))
}

main().catch((err) => {
  log(`fatal: ${(err as Error).stack ?? String(err)}`)
  logStream.end(() => process.exit(1))
})
