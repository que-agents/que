// Daemon smoke check: with a fresh QUE_HOME, start the daemon through the
// client, run a one-shot PTY, wait for its marker, then shut the daemon down.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import { join } from 'node:path'

process.env.QUE_HOME = mkdtempSync(join(os.tmpdir(), 'que-smoke-'))
// Never the user's config; quiet hours off so the smoke check runs at any hour.
process.env.QUE_CONFIG = join(process.env.QUE_HOME, 'config.toml')
writeFileSync(process.env.QUE_CONFIG, '[quiet_hours]\nenabled = false\n')
const require = createRequire(import.meta.url)
const { DaemonClient } = require('../out/client/index.js')

let client = null
const timer = setTimeout(() => {
  console.log('smoke: timed out after 15s')
  void shutdown().finally(() => process.exit(1))
}, 15_000)

async function shutdown() {
  if (!client?.connected) return
  try {
    await client.request('daemon.shutdown')
  } catch {
    // Connection may close before the reply is read.
  }
  client.close()
}

client = await DaemonClient.connectOrStart()
const ping = await client.request('daemon.ping')
console.log(`smoke: daemon pid=${ping.pid} node=${ping.nodeVersion} home=${process.env.QUE_HOME}`)

let buf = ''
let done = false
const { id } = await client.request('term.create', {
  file: '/bin/sh',
  args: ['-c', 'printf "QUE_SMOKE_OK\\n"'],
  cols: 80,
  rows: 24
})
await client.request('term.attach', { id, cols: 80, rows: 24 }).then((r) => (buf += r.snapshot))
client.on('term.data', (e) => {
  if (e.id === id) buf += e.data
})

while (!done) {
  if (!buf.includes('QUE_SMOKE_OK')) {
    const snap = await client.request('term.snapshot', { id })
    if (snap.text.includes('QUE_SMOKE_OK')) buf += snap.text
  }
  if (buf.includes('QUE_SMOKE_OK')) {
    done = true
    break
  }
  await new Promise((r) => setTimeout(r, 100))
}

console.log('smoke: QUE_SMOKE_OK')
clearTimeout(timer)
await shutdown()
process.exit(0)
