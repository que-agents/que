// electron-builder afterPack hook: copies through extraResources do not keep
// file modes reliably, and npm drops the execute bit on node-pty's prebuilt
// spawn-helper. Without it every terminal fails to start, so set it here,
// before anything is signed.
const fs = require('node:fs')
const path = require('node:path')

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)

    if (entry.isDirectory()) walk(p, out)
    else if (entry.name === 'spawn-helper') out.push(p)
  }

  return out
}

exports.default = async function afterPack(context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const resources = path.join(app, 'Contents', 'Resources')

  const executables = [
    ...walk(path.join(resources, 'daemon', 'node_modules', 'node-pty'), []),
    path.join(resources, 'cli', 'que')
  ]

  for (const file of executables) {
    if (!fs.existsSync(file)) throw new Error(`afterPack: missing ${file}`)
    fs.chmodSync(file, 0o755)
  }
}
