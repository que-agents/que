import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installCli } from '../main/install-cli'
import { bundleVersion, locateBundle, parseArgs, swapBundle } from '../../scripts/install-local.mjs'

const run = promisify(execFile)
const script = resolve(__dirname, '../../scripts/install-local.mjs')

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(join(os.tmpdir(), 'que-install-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** A directory tree shaped like que.app: Info.plist and the CLI launcher. */
function fakeBundle(root: string, version: string, marker = 'launcher'): string {
  const app = join(root, 'que.app')
  fs.mkdirSync(join(app, 'Contents', 'Resources', 'cli'), { recursive: true })
  fs.writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0"?><plist><dict><key>CFBundleShortVersionString</key>\n<string>${version}</string></dict></plist>`
  )
  fs.writeFileSync(join(app, 'Contents', 'Resources', 'cli', 'que'), `#!/bin/sh\n# ${marker}\n`, {
    mode: 0o755
  })

  return app
}

function listing(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true }).map(String).sort()
}

describe('locateBundle', () => {
  it('returns the newest release/mac*/que.app and ignores other folders', () => {
    const older = fakeBundle(join(tmp, 'mac-x64'), '1.0.0')
    const newer = fakeBundle(join(tmp, 'mac-arm64'), '1.0.1')
    fs.mkdirSync(join(tmp, 'linux-unpacked', 'que.app'), { recursive: true })
    fs.utimesSync(older, new Date(2020, 1, 1), new Date(2020, 1, 1))
    fs.utimesSync(newer, new Date(2026, 1, 1), new Date(2026, 1, 1))

    expect(locateBundle(tmp)).toBe(newer)
  })

  it('returns undefined when there is no release folder or no bundle in it', () => {
    expect(locateBundle(join(tmp, 'release'))).toBeUndefined()
    fs.mkdirSync(join(tmp, 'mac-arm64'))
    expect(locateBundle(tmp)).toBeUndefined()
  })
})

describe('parseArgs', () => {
  it('defaults to a build, a link and a launch into /Applications', () => {
    expect(parseArgs([])).toEqual({
      build: true,
      link: true,
      launch: true,
      from: undefined,
      dest: '/Applications/que.app'
    })
  })

  it('reads the flags and resolves the paths', () => {
    expect(
      parseArgs(['--no-build', '--no-link', '--no-launch', '--from', 'a.app', '--dest', tmp])
    ).toMatchObject({ build: false, link: false, launch: false, from: resolve('a.app'), dest: tmp })
  })

  it('rejects an unknown flag and a flag missing its path', () => {
    expect(() => parseArgs(['--nope'])).toThrow('unknown option --nope')
    expect(() => parseArgs(['--dest'])).toThrow('--dest needs a path')
  })
})

describe('bundleVersion', () => {
  it('reads CFBundleShortVersionString from Info.plist', () => {
    expect(bundleVersion(fakeBundle(tmp, '2.7.3'))).toBe('2.7.3')
  })

  it('returns undefined without a plist', () => {
    expect(bundleVersion(join(tmp, 'missing.app'))).toBeUndefined()
  })
})

describe('swapBundle', () => {
  it('installs a complete copy where nothing was', () => {
    const src = fakeBundle(join(tmp, 'src'), '1.2.0')
    const dest = join(tmp, 'apps', 'que.app')

    swapBundle(src, dest)

    expect(listing(dest)).toEqual(listing(src))
    expect(fs.readdirSync(join(tmp, 'apps'))).toEqual(['que.app'])
  })

  it('replaces an existing bundle and leaves nothing of the old one or a .old/.new', () => {
    const dest = fakeBundle(join(tmp, 'apps'), '1.0.0', 'old-launcher')
    fs.writeFileSync(join(dest, 'Contents', 'only-in-old'), 'x')
    const src = fakeBundle(join(tmp, 'src'), '1.2.0', 'new-launcher')

    swapBundle(src, dest)

    expect(bundleVersion(dest)).toBe('1.2.0')
    expect(fs.readFileSync(join(dest, 'Contents/Resources/cli/que'), 'utf8')).toContain(
      'new-launcher'
    )
    expect(listing(dest)).toEqual(listing(src))
    expect(fs.readdirSync(join(tmp, 'apps'))).toEqual(['que.app'])
  })

  it('clears a .new and a .old left by an interrupted run', () => {
    const dest = fakeBundle(join(tmp, 'apps'), '1.0.0')
    fs.mkdirSync(`${dest}.new/junk`, { recursive: true })
    fs.mkdirSync(`${dest}.old/junk`, { recursive: true })
    const src = fakeBundle(join(tmp, 'src'), '1.2.0')

    swapBundle(src, dest)

    expect(fs.readdirSync(join(tmp, 'apps'))).toEqual(['que.app'])
    expect(listing(dest)).toEqual(listing(src))
  })

  it('keeps the existing bundle when the copy fails', () => {
    const dest = fakeBundle(join(tmp, 'apps'), '1.0.0')

    expect(() =>
      swapBundle(join(tmp, 'src'), dest, () => {
        throw new Error('disk full')
      })
    ).toThrow('disk full')

    expect(bundleVersion(dest)).toBe('1.0.0')
  })
})

describe('linking the command (the rules the app uses)', () => {
  const launcher = '/Applications/que.app/Contents/Resources/cli/que'

  it('creates the link in the system directory when it is writable', () => {
    const bin = join(tmp, 'bin')
    fs.mkdirSync(bin)

    const plan = installCli(launcher, join(tmp, 'home'), bin)

    expect(plan).toMatchObject({ link: join(bin, 'que'), action: 'create' })
    expect(fs.readlinkSync(join(bin, 'que'))).toBe(launcher)
  })

  it('replaces an older symlink, even one whose target is gone', () => {
    const bin = join(tmp, 'bin')
    fs.mkdirSync(bin)
    fs.symlinkSync('/elsewhere/que', join(bin, 'que'))

    const plan = installCli(launcher, join(tmp, 'home'), bin)

    expect(plan.action).toBe('replace')
    expect(fs.readlinkSync(join(bin, 'que'))).toBe(launcher)
  })

  it('refuses to clobber a real file', () => {
    const bin = join(tmp, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(join(bin, 'que'), 'mine')

    const plan = installCli(launcher, join(tmp, 'home'), bin)

    expect(plan.action).toBe('refuse')
    expect(fs.readFileSync(join(bin, 'que'), 'utf8')).toBe('mine')
  })

  it('falls back to ~/.local/bin when the system directory is missing', () => {
    const home = join(tmp, 'home')

    const plan = installCli(launcher, home, join(tmp, 'no-such-bin'))

    expect(plan.link).toBe(join(home, '.local', 'bin', 'que'))
    expect(fs.readlinkSync(plan.link)).toBe(launcher)
  })
})

describe('the script', () => {
  const env = () => ({
    ...process.env,
    QUE_INSTALL_SYSTEM_BIN: join(tmp, 'bin'),
    QUE_INSTALL_HOME: join(tmp, 'home')
  })

  it('installs the bundle, links the command and says the service keeps running', async () => {
    const src = fakeBundle(join(tmp, 'src'), '3.1.4')
    const dest = join(tmp, 'apps', 'que.app')
    fs.mkdirSync(join(tmp, 'bin'))

    const { stdout } = await run(
      'node',
      [script, '--no-build', '--from', src, '--dest', dest, '--no-launch'],
      { env: env() }
    )

    expect(stdout).toContain(`Installed que 3.1.4 at ${dest}`)
    expect(stdout).toContain(join(tmp, 'bin', 'que'))
    expect(stdout).toContain('background service was not touched')
    expect(listing(dest)).toEqual(listing(src))
    expect(fs.readlinkSync(join(tmp, 'bin', 'que'))).toBe(
      join(dest, 'Contents', 'Resources', 'cli', 'que')
    )
  })

  it('skips the link with --no-link', async () => {
    const src = fakeBundle(join(tmp, 'src'), '3.1.4')
    fs.mkdirSync(join(tmp, 'bin'))

    await run(
      'node',
      [
        script,
        '--no-build',
        '--from',
        src,
        '--dest',
        join(tmp, 'que.app'),
        '--no-launch',
        '--no-link'
      ],
      { env: env() }
    )

    expect(fs.readdirSync(join(tmp, 'bin'))).toEqual([])
  })

  it('exits non-zero with a clear message when there is no bundle', async () => {
    const failure = await run(
      'node',
      [
        script,
        '--no-build',
        '--from',
        join(tmp, 'gone.app'),
        '--dest',
        join(tmp, 'que.app'),
        '--no-launch'
      ],
      { env: env() }
    ).catch((e: { code: number; stderr: string }) => e)

    expect(failure).toMatchObject({ code: 1 })
    expect((failure as { stderr: string }).stderr).toContain('no que.app to install')
    expect(fs.existsSync(join(tmp, 'que.app'))).toBe(false)
  })
})
