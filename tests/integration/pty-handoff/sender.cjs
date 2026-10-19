// The sending side of the PTY handoff proof (pty-handoff.test.ts): opens a
// shell through node-pty, sees a first marker, stops reading, has the shell
// print a second marker into the kernel buffer, then spawns the receiver with
// the master fd in its stdio and exits once the receiver has taken it over.
// Usage: sender.cjs <receiver.cjs> <log file>
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const pty = require('node-pty')

const [receiver, logFile] = process.argv.slice(2)

const log = (entry) =>
  fs.appendFileSync(logFile, `${JSON.stringify({ from: 'sender', ...entry })}\n`)

const shell = pty.spawn('/bin/sh', [], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: { PATH: process.env.PATH, PS1: '$ ', TERM: 'xterm-256color' }
})

let seen = ''

shell.onData((data) => {
  seen += data

  if (!seen.includes('FIRST-MARK-7d1')) return
  seen = ''
  handOver()
})

shell.write('echo FIRST-MARK-$((7*1))d1\r')

let handed = false

function handOver() {
  if (handed) return
  handed = true
  // node-pty's pause() only stops the stream flowing; the handle would keep
  // reading into the stream's buffer. Stopping the handle leaves later bytes
  // in the kernel for the receiver.
  shell.pause()
  shell._socket._handle.readStop()
  shell.write('echo SECOND-MARK-$((4*2))e2\r')

  const child = spawn(process.execPath, [receiver, logFile, String(shell.pid)], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc', shell.fd],
    env: process.env
  })

  log({ event: 'spawned', shellPid: shell.pid, receiverPid: child.pid })
  child.on('message', (msg) => {
    if (msg.type !== 'adopted') return
    log({ event: 'exiting' })
    child.disconnect()
    child.unref()
    process.exit(0)
  })
}
