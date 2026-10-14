import { describe, expect, it } from 'vitest'
import { LAUNCHD_LABEL, renderPlist } from './launchd'

const plist = renderPlist({
  runtime: '/Applications/que.app/Contents/MacOS/que',
  daemonScript: '/Applications/que.app/Contents/Resources/daemon/index.js',
  queHome: '/Users/dev/.que',
  path: '/opt/homebrew/bin:/usr/bin:/bin',
  logPath: '/Users/dev/.que/logs/launchd.log'
})

/** The value following `<key>name</key>` (one line). */
function valueAfter(key: string): string {
  const lines = plist.split('\n')
  return lines[lines.findIndex((l) => l.trim() === `<key>${key}</key>`) + 1]?.trim() ?? ''
}

describe('renderPlist', () => {
  it('runs the daemon script with the runtime as Node under the que label', () => {
    expect(valueAfter('Label')).toBe(`<string>${LAUNCHD_LABEL}</string>`)
    expect(plist).toContain(
      '<array>\n    <string>/Applications/que.app/Contents/MacOS/que</string>\n    <string>/Applications/que.app/Contents/Resources/daemon/index.js</string>\n  </array>'
    )
    expect(valueAfter('ELECTRON_RUN_AS_NODE')).toBe('<string>1</string>')
    expect(valueAfter('QUE_HOME')).toBe('<string>/Users/dev/.que</string>')
    expect(valueAfter('PATH')).toBe('<string>/opt/homebrew/bin:/usr/bin:/bin</string>')
  })

  it('starts at load, restarts after a crash, and logs to QUE_HOME', () => {
    expect(valueAfter('RunAtLoad')).toBe('<true/>')
    expect(plist).toContain(
      '<key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>'
    )
    expect(valueAfter('StandardOutPath')).toBe('<string>/Users/dev/.que/logs/launchd.log</string>')
    expect(valueAfter('StandardErrorPath')).toBe(
      '<string>/Users/dev/.que/logs/launchd.log</string>'
    )
  })

  it('escapes XML in paths', () => {
    const odd = renderPlist({
      runtime: '/Users/dev/R&D <tools>/que',
      daemonScript: '/x.js',
      queHome: '/h',
      path: '/bin',
      logPath: '/h/l'
    })

    expect(odd).toContain('<string>/Users/dev/R&amp;D &lt;tools&gt;/que</string>')
  })
})
