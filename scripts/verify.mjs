// `npm run verify`: every check, in order, stopping at the first failure.
// Each step runs with inherited stdio and is judged only by its own exit code:
// nothing is piped, so no filter can hide a failure. One summary line per step.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const STEPS = [
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['lint', 'npm', ['run', 'lint']],
  ['build', 'npm', ['run', 'build']],
  ['test', 'npx', ['vitest', 'run']],
  // The bundles are fresh from the build step; run the smoke script directly.
  ['smoke', 'node', ['scripts/smoke.mjs']],
  ['e2e', 'npx', ['playwright', 'test']]
]

const summary = []
let failed = null

for (const [name, cmd, args] of STEPS) {
  console.log(`\n=== verify: ${name} (${[cmd, ...args].join(' ')})\n`)
  const started = Date.now()
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: process.env })
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  const code = r.status ?? (r.signal ? `signal ${r.signal}` : 1)
  const ok = r.status === 0
  summary.push(
    `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(9)} ${secs.padStart(6)}s${ok ? '' : `  (exit ${code})`}`
  )

  if (!ok) {
    failed = name
    break
  }
}

for (const [name] of STEPS.slice(summary.length)) summary.push(`SKIP  ${name}`)

console.log('\n=== verify summary')

for (const line of summary) console.log(line)

console.log(failed ? `verify: FAILED at ${failed}` : 'verify: all steps passed')

process.exit(failed ? 1 : 0)
