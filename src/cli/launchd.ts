// `que daemon install|uninstall`: an opt-in launchd agent that starts the
// daemon at login and restarts it if it dies. Rendering is pure; the CLI
// writes the file and (unless --no-load) runs launchctl.
import os from 'node:os'
import { join } from 'node:path'

export const LAUNCHD_LABEL = 'dev.que.daemon'

export interface PlistOptions {
  /** Program that runs the daemon script as Node (the Electron binary). */
  runtime: string
  daemonScript: string
  queHome: string
  /** PATH for the daemon, so it finds claude, gh, git, and caffeinate. */
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
