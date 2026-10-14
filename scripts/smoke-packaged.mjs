// Packaged-app smoke check (`npm run smoke:packaged`): builds que.app with
// electron-builder (`npm run package`; pass --no-build to reuse release/),
// launches it through Playwright with a fresh QUE_HOME, QUE_E2E=1 and the fakes
// first on PATH, and checks that:
//   - the daemon the app starts runs from inside que.app/Contents/Resources,
//     under the app's own binary;
//   - a terminal opens and runs a command (read through window.__que);
//   - the tray title is readable;
//   - Contents/Resources/cli/que --version prints the package version;
// then quits the app, stops the daemon, and checks no process is left.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const log = (msg) => console.log(`smoke:packaged: ${msg}`)

if (!process.argv.includes('--no-build')) {
  const r = spawnSync('npm', ['run', 'package'], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) {
    log('npm run package failed')
    process.exit(1)
  }
}

const releaseDir = join(root, 'release')
const appPath = existsSync(releaseDir)
  ? readdirSync(releaseDir)
      .filter((d) => d.startsWith('mac'))
      .map((d) => join(releaseDir, d, 'que.app'))
      .find((p) => existsSync(p))
  : undefined
if (!appPath) {
  log('no release/mac*/que.app; run npm run package')
  process.exit(1)
}
const executablePath = join(appPath, 'Contents', 'MacOS', 'que')
const resources = join(appPath, 'Contents', 'Resources')
const cliLauncher = join(resources, 'cli', 'que')
log(`app ${appPath}`)

// The same isolation as the e2e specs: a fresh home, quiet hours off, the
// fakes first on PATH, never the user's config or git identity.
const queHome = mkdtempSync(join(os.tmpdir(), 'que-pkg-'))
writeFileSync(join(queHome, 'config.toml'), '[quiet_hours]\nenabled = false\n')
writeFileSync(
  join(queHome, 'gitconfig'),
  '[user]\n\tname = que smoke\n\temail = smoke@que.invalid\n'
)
const env = {}
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
Object.assign(env, {
  QUE_HOME: queHome,
  QUE_CONFIG: join(queHome, 'config.toml'),
  QUE_E2E: '1',
  QUE_UPDATE_CHECK: '0',
  PATH: `${join(root, 'tests/fakes/bin')}:${process.env.PATH}`,
  GIT_CONFIG_GLOBAL: join(queHome, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1'
})

const que = (...args) => execFileSync(cliLauncher, args, { env, encoding: 'utf8' }).trim()

async function poll(what, fn, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await fn()
      if (last) return last
    } catch (err) {
      last = err
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`timed out waiting for ${what} (last: ${String(last)})`)
}

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const leftovers = () => spawnSync('pgrep', ['-fl', appPath], { encoding: 'utf8' }).stdout.trim()

let app = null
let daemonPid = null
let failed = false
try {
  app = await electron.launch({ executablePath, args: [], env })
  const window = await app.firstWindow()
  log(`launched; window ${await window.title()}`)

  // 1. The daemon runs from inside the bundle, under the app binary.
  const status = await poll('the daemon', () => {
    const s = JSON.parse(que('daemon', 'status', '--json'))
    return s.running ? s : null
  })
  daemonPid = status.pid
  const command = execFileSync('ps', ['-o', 'command=', '-p', String(daemonPid)], {
    encoding: 'utf8'
  }).trim()
  log(`daemon pid=${daemonPid} version=${status.version}: ${command}`)
  const expected = `${executablePath} ${join(resources, 'daemon', 'index.js')}`
  if (command !== expected) throw new Error(`daemon command is ${command}, expected ${expected}`)
  if (status.version !== pkg.version) throw new Error(`daemon version ${status.version}`)

  // 2. A terminal opens and runs a command.
  await window.waitForFunction(() => window.__que !== undefined, null, { timeout: 20_000 })
  const termId = await poll('a terminal', () => window.evaluate(() => window.__que.activeTermId()))
  await window.evaluate(
    (id) => window.que.term.write({ id, data: 'echo QUE_PKG_$((6*7))\r' }),
    termId
  )
  await poll('the marker on screen', () =>
    window.evaluate(() =>
      window.__que
        .screenText()
        .split('\n')
        .some((l) => l.trim() === 'QUE_PKG_42')
    )
  )
  log(`terminal ${termId} printed QUE_PKG_42`)

  // 3. The tray title.
  const tray = await poll('the tray title', () => window.evaluate(() => window.__que.trayTitle()))
  log(`tray title "${tray}"`)
  if (!/^● \d+ ▸ \d+ ✕ \d+$/.test(tray)) throw new Error(`unexpected tray title "${tray}"`)

  // 4. The shipped CLI launcher.
  const version = que('--version')
  log(`Contents/Resources/cli/que --version → ${version}`)
  if (version !== pkg.version) throw new Error(`cli/que --version printed ${version}`)
} catch (err) {
  failed = true
  log(`FAILED: ${err instanceof Error ? err.message : String(err)}`)
} finally {
  // The app first, so it cannot reconnect and start another daemon.
  await app?.close().catch(() => {})
  try {
    que('daemon', 'stop')
  } catch {
    // Already stopped.
  }
  if (daemonPid !== null) {
    await poll('the daemon to exit', () => !pidAlive(daemonPid), 10_000).catch((e) => {
      failed = true
      log(e.message)
    })
  }
  await poll('no processes from the app', () => leftovers() === '', 10_000).catch(() => {
    failed = true
    log(`processes left behind:\n${leftovers()}`)
  })
  rmSync(queHome, { recursive: true, force: true })
}

log(failed ? 'FAILED' : 'ok')
process.exit(failed ? 1 : 0)
