// `que daemon install` and `que daemon uninstall` of the real CLI: the launchd agent, written
// to a temp LaunchAgents directory and never loaded.
import fs from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCliWith } from '../../src/testing/cli'
import { startTestDaemon, type TestDaemon } from '../../src/testing/daemon-harness'

let daemon: TestDaemon

beforeEach(async () => {
  daemon = await startTestDaemon()
})

afterEach(async () => {
  await daemon.close()
})

describe('que daemon install / uninstall', () => {
  it('writes the launchd agent to QUE_LAUNCH_AGENTS_DIR without loading it, and removes it', async () => {
    const agents = join(daemon.home, 'LaunchAgents')
    const env = { QUE_LAUNCH_AGENTS_DIR: agents }
    const plist = join(agents, 'dev.que.daemon.plist')

    const installed = await runCliWith({ env }, 'daemon', 'install', '--no-load')

    expect(installed).toMatchObject({ code: 0, stdout: `wrote ${plist}\n` })
    const text = fs.readFileSync(plist, 'utf8')
    expect(text).toContain('<string>dev.que.daemon</string>')
    expect(text).toContain(`<key>QUE_HOME</key>\n    <string>${daemon.home}</string>`)
    expect(text).toMatch(/<string>[^<]+\/daemon\/index\.js<\/string>/)
    expect(text).toContain('<key>RunAtLoad</key>\n  <true/>')

    const removed = await runCliWith({ env }, 'daemon', 'uninstall', '--no-load')

    expect(removed).toMatchObject({ code: 0, stdout: `removed ${plist}\n` })
    expect(fs.existsSync(plist)).toBe(false)
  }, 30_000)
})
