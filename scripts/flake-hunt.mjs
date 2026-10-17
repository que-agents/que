// Flake hunt: runs `vitest run` N times (default 10) and collects every failing
// test name and message into test-results/flake-hunt.log. The last `--load`
// runs (default 2) run while the Playwright e2e suite runs concurrently, to add
// CPU and I/O load. Exits non-zero if any run had a failure.
//
//   npm run test:flaky -- 10            ten runs, the last two under e2e load
//   npm run test:flaky -- 5 --load 0    five runs, no e2e load
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

const flag = (name, fallback) => {
  const i = args.indexOf(name)

  return i >= 0 ? Number(args[i + 1]) : fallback
}

const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
const runs = Number(positional[0] ?? 10)
const loadRuns = Math.min(runs, flag('--load', 2))

if (!Number.isInteger(runs) || runs < 1) {
  console.error('usage: flake-hunt.mjs [runs] [--load <runs under e2e load>]')
  process.exit(2)
}

const resultsDir = join(root, 'test-results')

mkdirSync(resultsDir, { recursive: true })

const logPath = join(resultsDir, 'flake-hunt.log')

writeFileSync(
  logPath,
  `flake hunt ${new Date().toISOString()}: ${runs} runs, ${loadRuns} under e2e load\n`
)

const log = (line) => {
  appendFileSync(logPath, `${line}\n`)
  console.log(line)
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: root,
      stdio: opts.stdio ?? 'inherit',
      env: process.env
    })

    let out = ''
    child.stdout?.on('data', (d) => (out += d))
    child.stderr?.on('data', (d) => (out += d))
    child.on('close', (code, signal) => resolveRun({ code: code ?? (signal ? 1 : 0), out }))
  })
}

/** Failed tests from a vitest JSON report. */
function failures(jsonPath) {
  if (!existsSync(jsonPath))
    return [{ name: '(no JSON report)', message: 'vitest wrote no report' }]
  const report = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const found = []

  for (const file of report.testResults ?? []) {
    for (const t of file.assertionResults ?? []) {
      if (t.status !== 'failed') continue
      found.push({
        name: `${file.name.replace(`${root}/`, '')} > ${t.fullName}`,
        message: (t.failureMessages ?? []).join('\n').split('\n').slice(0, 12).join('\n')
      })
    }

    if (
      file.status === 'failed' &&
      !(file.assertionResults ?? []).some((t) => t.status === 'failed')
    ) {
      found.push({
        name: file.name.replace(`${root}/`, ''),
        message: file.message ?? 'suite failed'
      })
    }
  }

  return found
}

if (loadRuns > 0) {
  log('building the app for the e2e load runs')
  const b = await run('npm', ['run', 'build'], { stdio: 'pipe' })

  if (b.code !== 0) {
    log(`build failed:\n${b.out}`)
    process.exit(1)
  }
}

const tally = new Map()
let failedRuns = 0

for (let i = 1; i <= runs; i++) {
  const underLoad = i > runs - loadRuns
  const jsonPath = join(resultsDir, `flake-hunt-run-${i}.json`)
  rmSync(jsonPath, { force: true })
  const started = Date.now()

  const e2e = underLoad
    ? run('npx', ['playwright', 'test'], { stdio: 'pipe' }).then((r) => ({
        ...r,
        secs: ((Date.now() - started) / 1000).toFixed(0)
      }))
    : Promise.resolve(null)

  const vt = await run(
    'npx',
    ['vitest', 'run', '--reporter=dot', '--reporter=json', `--outputFile.json=${jsonPath}`],
    { stdio: 'pipe' }
  )

  const e2eResult = await e2e
  const failed = vt.code === 0 ? [] : failures(jsonPath)

  if (vt.code !== 0 && failed.length === 0) {
    failed.push({
      name: '(vitest exited non-zero)',
      message: vt.out.split('\n').slice(-30).join('\n')
    })
  }

  const secs = ((Date.now() - started) / 1000).toFixed(0)

  const load = underLoad
    ? ` (under e2e load: playwright exit ${e2eResult?.code} after ${e2eResult?.secs}s)`
    : ''

  log(
    `run ${i}/${runs}: ${failed.length === 0 ? 'pass' : `${failed.length} failed`} in ${secs}s${load}`
  )

  if (failed.length > 0) failedRuns++

  for (const f of failed) {
    log(`  FAIL ${f.name}\n${f.message.replace(/^/gm, '    ')}`)
    tally.set(f.name, (tally.get(f.name) ?? 0) + 1)
  }

  rmSync(jsonPath, { force: true })
}

log(`\nsummary: ${runs - failedRuns}/${runs} runs passed`)

for (const [name, n] of tally) log(`  ${n}x ${name}`)

log(`log: ${logPath}`)

process.exit(failedRuns === 0 ? 0 : 1)
