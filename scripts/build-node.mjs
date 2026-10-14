// Bundles the Node-side programs that run outside Electron's renderer/main:
// the daemon (runs under Electron as Node), the CLI (runs under system node),
// and a standalone client bundle for scripts.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  // node-pty is native; electron resolves to its binary path at runtime.
  external: ['node-pty', 'electron'],
  define: { __QUE_VERSION__: JSON.stringify(pkg.version) }
}

await Promise.all([
  build({ ...common, entryPoints: [resolve(root, 'src/daemon/index.ts')], outfile: resolve(root, 'out/daemon/index.js') }),
  build({ ...common, entryPoints: [resolve(root, 'src/cli/index.ts')], outfile: resolve(root, 'out/cli/index.js') }),
  build({ ...common, entryPoints: [resolve(root, 'src/shared/client.ts')], outfile: resolve(root, 'out/client/index.js') })
])
