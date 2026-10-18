// The receiving side of the PTY handoff proof: takes the master fd at stdio
// index 4, reads what the shell printed while nobody read, and once the sender
// has exited, resizes through node-pty's own binding, writes a command, and
// tells the shell to exit once it has answered.
// Usage: receiver.cjs <log file> <shell pid>
const fs = require('node:fs')
const tty = require('node:tty')
const { loadNativeModule } = require('node-pty/lib/utils')

const binding = loadNativeModule('pty').module
const [logFile, shellPid] = process.argv.slice(2)
const pid = Number(shellPid)

const log = (entry) =>
  fs.appendFileSync(logFile, `${JSON.stringify({ from: 'receiver', ...entry })}\n`)

const FD = 4

function alive() {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

// Read as node-pty does (a tty stream over the fd); write straight to the fd.
const socket = new tty.ReadStream(FD)
const write = (text) => fs.writeSync(FD, text)

socket.setEncoding('utf8')

let seen = ''
let exiting = false

socket.on('data', (data) => {
  log({ event: 'data', data })
  seen += data

  // The size the shell reports after the resize; then the shell is told to exit.
  if (!exiting && /40 100/.test(seen)) {
    exiting = true
    log({ event: 'exiting-shell', shellAlive: alive() })
    write('exit\r')
  }
})

socket.on('end', () => {
  log({ event: 'end' })
  process.exit(0)
})

socket.on('error', (err) => {
  log({ event: 'error', code: err.code })
  process.exit(0)
})

process.on('disconnect', () => {
  log({ event: 'sender-gone', shellAlive: alive() })
  binding.resize(FD, 100, 40)
  write('echo THIRD-MARK-$((3*3))f3; stty size\r')
})

process.on('SIGHUP', () => log({ event: 'sighup' }))

process.send({ type: 'adopted' })
