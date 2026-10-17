// Bundles a node entry point (the CLI, the daemon) from source so tests run
// the current code as a real subprocess without depending on `npm run build`.
import fs from 'node:fs'
import { join, resolve } from 'node:path'
import { buildSync } from 'esbuild'
import { REPO_ROOT } from './fakes'

// Inside node_modules so the bundle's `require('node-pty')` resolves.
const OUT_DIR = join(REPO_ROOT, 'node_modules/.cache/que-test-bundles')
const built = new Map<string, string>()

/** Returns the path of a fresh CommonJS bundle of `entry`, built once per worker. */
export function bundleEntry(entry: 'src/cli/index.ts' | 'src/daemon/index.ts'): string {
  const cached = built.get(entry)

  if (cached) return cached
  const name = entry.split('/')[1]
  const outfile = join(OUT_DIR, `${name}.js`)
  // Parallel workers each build to their own file, then atomically rename it
  // into place; a process already running the old file keeps its copy.
  const tmpfile = join(OUT_DIR, `${name}.${process.pid}.tmp.js`)
  buildSync({
    entryPoints: [resolve(REPO_ROOT, entry)],
    outfile: tmpfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    tsconfig: resolve(REPO_ROOT, 'tsconfig.node.json'),
    external: ['node-pty', 'electron'],
    define: { __QUE_VERSION__: JSON.stringify('0.0.0-test') },
    logLevel: 'silent'
  })
  fs.renameSync(tmpfile, outfile)
  built.set(entry, outfile)

  return outfile
}
