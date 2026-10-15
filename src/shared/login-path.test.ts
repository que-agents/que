import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loginShellPath, mergePath } from './login-path'

describe('mergePath', () => {
  it('keeps the current PATH when there is no login PATH', () => {
    expect(mergePath('/usr/bin:/bin', null)).toBe('/usr/bin:/bin')
    expect(mergePath('/usr/bin', '')).toBe('/usr/bin')
    expect(mergePath(undefined, null)).toBe('')
  })

  it('puts the login entries first, then the current-only extras', () => {
    expect(mergePath('/usr/bin:/extra', '/opt/homebrew/bin:/usr/bin')).toBe(
      '/opt/homebrew/bin:/usr/bin:/extra'
    )
  })

  it('drops duplicates and empty entries', () => {
    expect(mergePath('/a::/b', '/b::/c:/b')).toBe('/b:/c:/a')
  })

  it('uses the login PATH alone when there is no current one', () => {
    expect(mergePath(undefined, '/x:/y')).toBe('/x:/y')
  })
})

describe('loginShellPath', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(join(os.tmpdir(), 'que-login-'))
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('reads the PATH a login shell builds from its profile', async () => {
    fs.writeFileSync(join(home, '.profile'), 'PATH="/opt/que-test/bin:$PATH"\n')

    const path = await loginShellPath({
      shell: '/bin/sh',
      env: { HOME: home, PATH: '/usr/bin:/bin' }
    })

    expect(path?.startsWith('/opt/que-test/bin:')).toBe(true)
  })

  it('resolves null when the shell cannot run', async () => {
    expect(await loginShellPath({ shell: join(home, 'no-such-shell') })).toBeNull()
  })
})
