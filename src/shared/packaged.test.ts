import { describe, expect, it } from 'vitest'
import { cliRunnerFrom, queScript } from '../daemon/wrapper'
import {
  appExecutable,
  cliScriptFrom,
  daemonScriptFrom,
  packagedResourcesDir,
  runtimeFrom
} from './packaged'
import { quePaths } from './paths'

const APP = '/Applications/que.app'
const RES = `${APP}/Contents/Resources`
const DEV = '/Users/dev/code/que/out'

describe('packaged paths', () => {
  describe('packagedResourcesDir', () => {
    it.each([
      [`${RES}/cli`, RES],
      [`${RES}/daemon`, RES],
      [`${RES}/app.asar/out/main`, RES],
      [RES, RES],
      [
        '/Users/dev/Applications/que.app/Contents/Resources/client',
        '/Users/dev/Applications/que.app/Contents/Resources'
      ]
    ])('finds the bundle resources from %s', (dir, expected) => {
      expect(packagedResourcesDir(dir)).toBe(expected)
    })

    it.each([[`${DEV}/main`], [`${DEV}/cli`], ['/Users/dev/code/Contents/Resources/x']])(
      'is null in a development layout (%s)',
      (dir) => {
        expect(packagedResourcesDir(dir)).toBeNull()
      }
    )
  })

  describe('bundle locations', () => {
    it('points the daemon and CLI into Resources when packaged, from main or any bundle', () => {
      expect(daemonScriptFrom(`${RES}/app.asar/out/main`)).toBe(`${RES}/daemon/index.js`)
      expect(daemonScriptFrom(`${RES}/cli`)).toBe(`${RES}/daemon/index.js`)
      expect(cliScriptFrom(`${RES}/daemon`)).toBe(`${RES}/cli/index.js`)
      expect(appExecutable(RES)).toBe(`${APP}/Contents/MacOS/que`)
    })

    it('uses the sibling bundles in out/ in development', () => {
      expect(daemonScriptFrom(`${DEV}/main`)).toBe(`${DEV}/daemon/index.js`)
      expect(cliScriptFrom(`${DEV}/daemon`)).toBe(`${DEV}/cli/index.js`)
    })
  })

  describe('runtimeFrom', () => {
    it('is the current executable under Electron (the app, or a bundle it runs as Node)', () => {
      const proc = { execPath: `${APP}/Contents/MacOS/que`, versions: { electron: '41.10.7' } }
      expect(runtimeFrom(`${RES}/cli`, proc)).toBe(`${APP}/Contents/MacOS/que`)
    })

    it('is the app binary for a packaged bundle run by another Node', () => {
      const proc = { execPath: '/usr/local/bin/node', versions: {} }
      expect(runtimeFrom(`${RES}/cli`, proc)).toBe(`${APP}/Contents/MacOS/que`)
    })

    it('is null under plain Node in development, so the electron package decides', () => {
      expect(
        runtimeFrom(`${DEV}/cli`, { execPath: '/usr/local/bin/node', versions: {} })
      ).toBeNull()
    })
  })

  describe('the hooks wrapper bin/que', () => {
    it('runs the bundled CLI with the app binary as Node when packaged', () => {
      const runner = cliRunnerFrom(`${RES}/daemon`, () => '/usr/local/bin/node')
      expect(runner).toEqual({ nodePath: `${APP}/Contents/MacOS/que`, runAsNode: true })

      const script = queScript({
        paths: quePaths(),
        ...runner,
        cliScript: `${RES}/cli/index.js`
      })

      expect(script).toContain(
        `ELECTRON_RUN_AS_NODE=1 exec '${APP}/Contents/MacOS/que' '${RES}/cli/index.js' "$@"`
      )
    })

    it('runs the CLI with node from PATH in development', () => {
      const runner = cliRunnerFrom(`${DEV}/daemon`, () => '/usr/local/bin/node')
      expect(runner).toEqual({ nodePath: '/usr/local/bin/node', runAsNode: false })

      const script = queScript({ paths: quePaths(), ...runner, cliScript: `${DEV}/cli/index.js` })
      expect(script).toContain(`\nexec '/usr/local/bin/node' '${DEV}/cli/index.js' "$@"`)
      expect(script).not.toContain('ELECTRON_RUN_AS_NODE')
    })
  })
})
