// `que daemon install|uninstall`: an opt-in launchd agent that starts the
// daemon at login and restarts it if it dies. Rendering is pure; the
// commands write the file and (unless --no-load) run launchctl.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import { resolveDaemonScript, resolveRuntime } from '../shared/client'
import { quePaths } from '../shared/paths'

export const LAUNCHD_LABEL = 'dev.que.daemon'

export interface PlistOptions {
  /** Program that runs the daemon script as Node (the Electron binary). */
  runtime: string
  daemonScript: string
  queHome: string
  /** PATH for the daemon, so it finds claude, gh and git. */
  path: string
  /** Where launchd sends the daemon's stdout and stderr. */
  logPath: string
}

function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** The launchd property list for the daemon agent. */
export function renderPlist(o: PlistOptions): string {
  const s = (v: string): string => `<string>${xml(v)}</string>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${s(LAUNCHD_LABEL)}
  <key>ProgramArguments</key>
  <array>
    ${s(o.runtime)}
    ${s(o.daemonScript)}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ELECTRON_RUN_AS_NODE</key>
    ${s('1')}
    <key>QUE_HOME</key>
    ${s(o.queHome)}
    <key>PATH</key>
    ${s(o.path)}
  </dict>
  <key>WorkingDirectory</key>
  ${s(o.queHome)}
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  ${s('Background')}
  <key>StandardOutPath</key>
  ${s(o.logPath)}
  <key>StandardErrorPath</key>
  ${s(o.logPath)}
</dict>
</plist>
`
}

/** $QUE_LAUNCH_AGENTS_DIR, else ~/Library/LaunchAgents. */
export function launchAgentsDir(): string {
  return process.env.QUE_LAUNCH_AGENTS_DIR || join(os.homedir(), 'Library', 'LaunchAgents')
}

export function plistPath(): string {
  return join(launchAgentsDir(), `${LAUNCHD_LABEL}.plist`)
}

/** Registers `que daemon install` and `que daemon uninstall`. */
export function registerLaunchdCommands(daemon: Command): void {
  daemon
    .command('install')
    .description('install a launchd agent that keeps the daemon running')
    .option('--no-load', 'write the agent without loading it')
    .action((opts: { load: boolean }) => {
      const paths = quePaths()
      const file = plistPath()
      fs.mkdirSync(dirname(file), { recursive: true })
      fs.writeFileSync(
        file,
        renderPlist({
          runtime: resolveRuntime(),
          daemonScript: resolveDaemonScript(),
          queHome: paths.home,
          path: process.env.PATH ?? '/usr/bin:/bin',
          logPath: join(paths.logsDir, 'launchd.log')
        })
      )
      console.log(`wrote ${file}`)

      if (opts.load) {
        const uid = process.getuid?.() ?? 0
        execFileSync('launchctl', ['bootstrap', `gui/${uid}`, file], { stdio: 'inherit' })
        console.log(`loaded ${LAUNCHD_LABEL}`)
      }
    })
  daemon
    .command('uninstall')
    .description('remove the launchd agent')
    .option('--no-load', 'remove the file without unloading the agent')
    .action((opts: { load: boolean }) => {
      const file = plistPath()

      if (opts.load && fs.existsSync(file)) {
        const uid = process.getuid?.() ?? 0

        try {
          execFileSync('launchctl', ['bootout', `gui/${uid}`, file], { stdio: 'inherit' })
        } catch {
          // Not loaded.
        }
      }

      fs.rmSync(file, { force: true })
      console.log(`removed ${file}`)
    })
}
