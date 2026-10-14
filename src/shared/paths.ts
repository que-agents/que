import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

/** Unix socket paths are limited (~104 bytes on macOS); stay safely below. */
const MAX_SOCKET_PATH = 100

export interface QuePaths {
  home: string
  socket: string
  pid: string
  logsDir: string
  daemonLog: string
  /** Per-workspace setup/teardown logs. */
  workspaceLogsDir: string
  /** SQLite database. */
  db: string
  /** The wrappers that sit first on PATH in workspace terminals (claude, que). */
  binDir: string
  /** Hook settings passed to Claude Code with --settings. */
  hooksJson: string
  /** Shell startup files for workspace terminals (zsh ZDOTDIR). */
  shellDir: string
  /** Set when the socket had to move to /tmp because the home path is too long. */
  socketFallback: boolean
}

export function queHome(): string {
  return process.env.QUE_HOME || join(os.homedir(), '.que')
}

/** Resolves (without creating) every path the daemon and clients share. */
export function quePaths(): QuePaths {
  const home = queHome()
  const logsDir = join(home, 'logs')
  let socket = join(home, 'daemon.sock')
  let socketFallback = false
  if (socket.length > MAX_SOCKET_PATH) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0
    socket = join('/tmp', `que-${uid}`, 'daemon.sock')
    socketFallback = true
  }
  return {
    home,
    socket,
    pid: join(home, 'daemon.pid'),
    logsDir,
    daemonLog: join(logsDir, 'daemon.log'),
    workspaceLogsDir: join(logsDir, 'workspaces'),
    db: join(home, 'que.db'),
    binDir: join(home, 'bin'),
    hooksJson: join(home, 'hooks.json'),
    shellDir: join(home, 'shell'),
    socketFallback
  }
}

/** Creates the home, logs and socket directories (owner-only) if missing. */
export function ensureDirs(p: QuePaths = quePaths()): QuePaths {
  fs.mkdirSync(p.home, { recursive: true, mode: 0o700 })
  fs.mkdirSync(p.logsDir, { recursive: true, mode: 0o700 })
  fs.mkdirSync(join(p.socket, '..'), { recursive: true, mode: 0o700 })
  return p
}
