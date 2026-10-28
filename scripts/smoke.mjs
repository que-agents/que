// Daemon smoke check: with a fresh QUE_HOME, start the daemon through the
// client, run a one-shot PTY, wait for its marker, tokenize one file through
// workspace.diffFile, then shut the daemon down.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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

// One workspace.diffFile round trip, so the tokenizer worker bundle beside the
// daemon bundle is found, started, and colours a file.
const repo = join(process.env.QUE_HOME, 'smoke-repo')

mkdirSync(repo)

writeFileSync(join(repo, 'README.md'), '# smoke\n')

for (const args of [
  ['init', '-q', '-b', 'main'],
  ['add', '.'],
  ['commit', '-q', '-m', 'Initial commit']
]) {
  const identity = ['-c', 'user.name=que smoke', '-c', 'user.email=smoke@que.invalid']
  execFileSync('git', [...identity, ...args], { cwd: repo, stdio: 'ignore' })
}

const project = await client.request('project.add', { path: repo })

const created = await client.request('workspace.create', {
  projectId: project.id,
  name: 'smoke-diff'
})

let ws = created

while (ws.status === 'preparing') {
  await new Promise((r) => setTimeout(r, 100))
  ws = await client.request('workspace.get', { id: created.id })
}

writeFileSync(join(ws.path, 'smoke.ts'), 'export const smoke = 1\n')

const diff = await client.request('workspace.diffFile', { id: ws.id, path: 'smoke.ts' })
const kinds = diff.hunks.flatMap((h) => h.lines).flatMap((l) => l.tokens.map((t) => t.kind))

if (diff.language !== 'typescript' || !kinds.includes('decl')) {
  console.log(`smoke: diffFile was not tokenized: ${JSON.stringify(diff).slice(0, 300)}`)
  await shutdown()
  process.exit(1)
}

console.log('smoke: diffFile tokenized by the worker')

clearTimeout(timer)

await shutdown()

process.exit(0)
