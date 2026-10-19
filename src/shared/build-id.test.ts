import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildIdOf, daemonIsStale, staleDaemonHint } from './build-id'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'que-build-id-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('buildIdOf', () => {
  it('is the first 12 hex characters of the sha256 of the bundle', () => {
    const bundle = join(dir, 'index.js')
    const text = '"use strict";\nconsole.log("que daemon 0.4.0");\n'
    fs.writeFileSync(bundle, text)

    const expected = createHash('sha256').update(text).digest('hex').slice(0, 12)
    expect(buildIdOf(bundle)).toBe(expected)
    expect(buildIdOf(bundle)).toMatch(/^[0-9a-f]{12}$/)
  })

  it('changes when the bundle is rebuilt with different contents', () => {
    const bundle = join(dir, 'index.js')
    fs.writeFileSync(bundle, 'module.exports = "build one"\n')
    const before = buildIdOf(bundle)

    fs.writeFileSync(bundle, 'module.exports = "build two"\n')

    expect(buildIdOf(bundle)).not.toBe(before)
  })

  it('is empty for a bundle that is not there', () => {
    expect(buildIdOf(join(dir, 'daemon', 'index.js'))).toBe('')
  })
})

describe('daemonIsStale', () => {
  it.each([
    ['3f9a2c71b0de', '3f9a2c71b0de', false],
    ['3f9a2c71b0de', '8c41e07d92aa', true],
    ['', '8c41e07d92aa', false],
    ['3f9a2c71b0de', '', false],
    ['', '', false]
  ])('daemon %j against expected %j is stale: %s', (daemonId, expectedId, stale) => {
    expect(daemonIsStale(daemonId, expectedId)).toBe(stale)
  })
})

describe('staleDaemonHint', () => {
  it('names both builds and recommends the update in place before the restart', () => {
    expect(staleDaemonHint('8c41e07d92aa', '3f9a2c71b0de')).toBe(
      'the daemon runs build 8c41e07d92aa, a different build than this que (3f9a2c71b0de); run `que daemon upgrade` (every terminal keeps running), or `que daemon restart` if that fails (it ends every terminal)'
    )
  })
})
