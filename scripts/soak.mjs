// Soak check, not part of CI (`npm run soak -- --minutes 10 --tasks 6`).
//
// Starts a daemon in a temp QUE_HOME with the fakes first on PATH and a temp
// repo with a bare origin, opens the queue with concurrency 2, and for the
// given minutes keeps `--tasks` tasks live (queued or running), cycling
// through fake claude scenarios (mostly success; a crash, a max_turns and a
// stall now and then). It samples the daemon's RSS every 30 s and at the end
// prints tasks done/failed, the peak RSS, and the RSS growth from the first
// minute to the last, then checks that no claude, caffeinate or PTY process
// is left behind. Exits non-zero on a leak or if no task finished.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) : fallback
}
const minutes = opt('minutes', 10)
const live = opt('tasks', 6)
const sampleMs = opt('sample-seconds', 30) * 1000
if (!(minutes > 0) || !(live > 0)) {
  console.error('usage: soak.mjs [--minutes 10] [--tasks 6] [--sample-seconds 30]')
  process.exit(2)
}
const log = (msg) => console.log(`soak: ${msg}`)

// ---- an isolated world ----------------------------------------------------------

const home = mkdtempSync(join(os.tmpdir(), 'que-soak-'))
const config = join(home, 'config.toml')
// Quiet hours off; a short stall timeout so the stall scenario ends in seconds.
writeFileSync(config, 'stall_timeout_minutes = 0.1\n\n[quiet_hours]\nenabled = false\n')
writeFileSync(
  join(home, 'gitconfig'),
  '[user]\n\tname = que soak\n\temail = soak@que.invalid\n[commit]\n\tgpgsign = false\n'
)
Object.assign(process.env, {
  QUE_HOME: home,
  QUE_CONFIG: config,
  PATH: `${join(root, 'tests/fakes/bin')}:${process.env.PATH}`,
  QUE_FAKE_CLAUDE_DELAY_MS: '20',
  QUE_FAKE_CLAUDE_TRANSCRIPT_DIR: join(home, 'transcripts'),
  QUE_FAKE_GH_LOG: join(home, 'fake-gh.log'),
  GIT_CONFIG_GLOBAL: join(home, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1'
})
delete process.env.ELECTRON_RUN_AS_NODE

const repo = join(home, 'repo')
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'ignore' })
execFileSync('mkdir', ['-p', repo])
git(repo, 'init', '-b', 'main')
writeFileSync(join(repo, 'README.md'), '# uploader\n')
writeFileSync(join(repo, 'que.toml'), 'setup = "true"\n')
git(repo, 'add', '.')
git(repo, 'commit', '-m', 'Initial commit')
git(home, 'clone', '--bare', '--quiet', repo, join(home, 'origin.git'))
git(repo, 'remote', 'add', 'origin', join(home, 'origin.git'))
git(repo, 'fetch', '--quiet', 'origin')

// ---- helpers ----------------------------------------------------------------------

const require = createRequire(import.meta.url)
const { DaemonClient } = require('../out/client/index.js')

function processes() {
  return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), command: m[4] }))
}

function descendants(pid) {
  const all = processes()
  const out = []
  const walk = (p) => {
    for (const c of all.filter((x) => x.ppid === p)) {
      out.push(c)
      walk(c.pid)
    }
  }
  walk(pid)
  return out
}

const rssMb = (pid) => (processes().find((p) => p.pid === pid)?.rssKb ?? 0) / 1024
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const LIVE = new Set(['queued', 'preparing', 'running', 'finishing', 'paused'])
const SCENARIOS = [
  'success',
  'success',
  'crash',
  'success',
  'max_turns',
  'success',
  'success',
  'stall'
]

// ---- the run ----------------------------------------------------------------------

const client = await DaemonClient.connectOrStart({ timeoutMs: 15_000 })
const { pid } = await client.request('daemon.ping')
log(`daemon pid=${pid} home=${home}; ${minutes} min, ${live} live tasks, concurrency 2`)
const project = await client.request('project.add', { path: repo })
await client.request('queue.open', { concurrency: 2 })

const started = Date.now()
const deadline = started + minutes * 60_000
const samples = [{ t: 0, mb: rssMb(pid) }]
let nextSample = started + sampleMs
let added = 0
let failures = 0

while (Date.now() < deadline) {
  const tasks = await client.request('task.list')
  const inFlight = tasks.filter((t) => LIVE.has(t.state)).length
  for (let i = inFlight; i < live; i++) {
    const scenario = SCENARIOS[added % SCENARIOS.length]
    added++
    await client.request('task.add', {
      projectId: project.id,
      brief: `Soak task ${added}: tidy the uploader [que-fake-scenario:${scenario}]`,
      maxTurns: 5
    })
  }
  if (Date.now() >= nextSample) {
    const s = { t: (Date.now() - started) / 1000, mb: rssMb(pid) }
    samples.push(s)
    const done = tasks.filter((t) => t.state === 'done').length
    log(
      `t=${s.t.toFixed(0)}s rss=${s.mb.toFixed(1)} MB added=${added} done=${done} live=${inFlight}`
    )
    nextSample += sampleMs
  }
  await sleep(1000)
}

// Stop adding; let what is running finish (stall tasks end at the stall timeout).
await client.request('queue.close')
for (const t of await client.request('task.list')) {
  // A closed queue starts nothing, so tasks still queued are stopped.
  if (t.state === 'queued') await client.request('task.stop', { id: t.id }).catch(() => {})
}
const drainDeadline = Date.now() + 120_000
while (Date.now() < drainDeadline) {
  const liveNow = (await client.request('task.list')).filter((t) => LIVE.has(t.state))
  if (liveNow.length === 0) break
  await sleep(1000)
}
samples.push({ t: (Date.now() - started) / 1000, mb: rssMb(pid) })

const final = await client.request('task.list')
const count = (s) => final.filter((t) => t.state === s).length
const end = samples[samples.length - 1].t
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
// The t=0 sample is a cold daemon; the first minute is the warm samples within it.
const firstMinute = mean(samples.flatMap((s) => (s.t > 0 && s.t <= 60 ? [s.mb] : [])))
const lastMinute = mean(samples.flatMap((s) => (s.t >= end - 60 ? [s.mb] : [])))
const peak = Math.max(...samples.map((s) => s.mb))

// Leak check while the daemon is still up: once the queue has drained, nothing
// it spawned for tasks (claude, caffeinate, PTYs) may still be running.
const leftovers = descendants(pid).filter((p) => !/\bps\b/.test(p.command))
for (const p of leftovers) {
  failures++
  log(`LEAK: pid ${p.pid} still running: ${p.command}`)
}

try {
  await client.request('daemon.shutdown')
} catch {
  // The connection may close before the reply.
}
client.close()
const gone = Date.now() + 10_000
while (Date.now() < gone && processes().some((p) => p.pid === pid)) await sleep(200)
if (processes().some((p) => p.pid === pid)) {
  failures++
  log(`LEAK: the daemon (pid ${pid}) did not exit`)
}
const strays = processes().filter((p) => p.command.includes(home))
for (const p of strays) {
  failures++
  log(`LEAK: pid ${p.pid} still references ${home}: ${p.command}`)
}

log('---')
log(
  `tasks added ${added}: done ${count('done')}, failed ${count('failed')}, stuck ${count('stuck')}, stopped ${count('stopped')}, still live ${final.filter((t) => LIVE.has(t.state)).length}`
)
log(
  `daemon RSS: peak ${peak.toFixed(1)} MB; first minute ${firstMinute.toFixed(1)} MB → last minute ${lastMinute.toFixed(1)} MB (${lastMinute - firstMinute >= 0 ? '+' : ''}${(lastMinute - firstMinute).toFixed(1)} MB)`
)
for (const t of final.filter((t) => LIVE.has(t.state))) {
  log(`still live after the drain: ${t.id} ${t.state} ${t.reason ?? ''}`)
}
log(`leaked processes: ${failures === 0 ? 'none' : failures}`)
if (count('done') === 0) {
  failures++
  log('no task finished')
}
rmSync(home, { recursive: true, force: true })
log(failures === 0 ? 'ok' : 'FAILED')
process.exit(failures === 0 ? 0 : 1)
