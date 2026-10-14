// Headless launch check: runs the built app with QUE_SMOKE=1, which makes the
// main process spawn a PTY via PtyManager and print a marker line.
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, QUE_SMOKE: '1' }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, [root], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
let done = false

function finish(code, msg) {
  if (done) return
  done = true
  clearTimeout(timer)
  if (msg) console.log(msg)
  child.kill()
  process.exit(code)
}

const timer = setTimeout(() => finish(1, 'smoke: timed out after 15s'), 15_000)

child.stdout.on('data', (d) => {
  out += d.toString()
  const line = out.split('\n').find((l) => l.includes('QUE_SMOKE_OK'))
  if (line) finish(0, `smoke: ${line.trim()}`)
})
child.stderr.on('data', (d) => process.stderr.write(d))
child.on('exit', (code) => {
  if (!done) finish(out.includes('QUE_SMOKE_OK') ? 0 : 1, `smoke: electron exited with ${code}`)
})
