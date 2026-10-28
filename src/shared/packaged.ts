// Where things live in a packaged que.app, worked out from a bundle's own
// directory, without importing electron (the daemon and the CLI run as plain
// Node). In the app, every Node-side bundle sits in Contents/Resources:
//
//   que.app/Contents/MacOS/que                     the app binary, also the Node runtime
//   que.app/Contents/Resources/daemon/index.js     (+ daemon/node_modules/node-pty)
//   que.app/Contents/Resources/cli/index.js        (+ cli/que, the PATH launcher)
//   que.app/Contents/Resources/client/index.js
//   que.app/Contents/Resources/app.asar/out/main   the Electron main process
//
// In development the same bundles sit side by side in out/.
import { dirname, join } from 'node:path'

const MARKER = '.app/Contents/Resources'

/** `…/que.app/Contents/Resources` if `dir` is inside an app bundle's resources, else null. */
export function packagedResourcesDir(dir: string): string | null {
  const at = dir.indexOf(`${MARKER}/`)

  if (at >= 0) return dir.slice(0, at + MARKER.length)

  return dir.endsWith(MARKER) ? dir : null
}

/** The app binary for a Resources directory: `…/que.app/Contents/MacOS/que`. */
export function appExecutable(resources: string): string {
  return join(dirname(resources), 'MacOS', 'que')
}

/** The daemon bundle: Resources/daemon/index.js when packaged, else a sibling in out/. */
export function daemonScriptFrom(dir: string): string {
  const res = packagedResourcesDir(dir)

  return res ? join(res, 'daemon', 'index.js') : join(dir, '..', 'daemon', 'index.js')
}

/**
 * The daemon's tokenizer worker bundle, beside the daemon bundle:
 * Resources/daemon/highlight-worker.js when packaged, else out/daemon/highlight-worker.js.
 * `dir` is the daemon bundle's own directory.
 */
export function tokenizerWorkerFrom(dir: string): string {
  const res = packagedResourcesDir(dir)

  return res ? join(res, 'daemon', 'highlight-worker.js') : join(dir, 'highlight-worker.js')
}

/** The CLI bundle: Resources/cli/index.js when packaged, else a sibling in out/. */
export function cliScriptFrom(dir: string): string {
  const res = packagedResourcesDir(dir)

  return res ? join(res, 'cli', 'index.js') : join(dir, '..', 'cli', 'index.js')
}

/**
 * The program that runs the daemon (and the CLI) as Node: the current
 * executable inside Electron (main process, or a bundle already running as
 * Node under the app binary), the app binary when packaged, else null (the
 * caller falls back to the `electron` package in development).
 */
export function runtimeFrom(
  dir: string,
  proc: { execPath: string; versions: { electron?: string } }
): string | null {
  if (proc.versions.electron) return proc.execPath
  const res = packagedResourcesDir(dir)

  return res ? appExecutable(res) : null
}
