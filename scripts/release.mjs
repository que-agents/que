// `npm run release -- <version>`: bumps package.json (and the lockfile's root
// entry), moves CHANGELOG.md's Unreleased notes under the new version, and
// prints the git commands to run. It commits, tags and pushes nothing itself.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = (process.argv[2] ?? '').replace(/^v/, '')
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('usage: npm run release -- <version>   (e.g. 0.2.0)')
  process.exit(2)
}

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const previous = pkg.version
pkg.version = version
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

const lockPath = join(root, 'package-lock.json')
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
lock.version = version
if (lock.packages?.['']) lock.packages[''].version = version
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)

const changelogPath = join(root, 'CHANGELOG.md')
let changelog = readFileSync(changelogPath, 'utf8')
const today = new Date().toISOString().slice(0, 10)
if (!changelog.includes(`## [${version}]`)) {
  changelog = changelog.replace(
    '## [Unreleased]\n',
    `## [Unreleased]\n\n## [${version}] - ${today}\n`
  )
  const repo = 'https://github.com/rquellh/que'
  changelog = changelog.replace(
    /^\[Unreleased\]: .*$/m,
    `[Unreleased]: ${repo}/compare/v${version}...HEAD\n[${version}]: ${repo}/compare/v${previous}...v${version}`
  )
  writeFileSync(changelogPath, changelog)
}

console.log(`que ${previous} → ${version}: package.json, package-lock.json, CHANGELOG.md updated.`)
console.log('Review CHANGELOG.md, then:\n')
console.log('  npm run verify')
console.log(`  git commit -am "Release v${version}"`)
console.log(`  git tag v${version}`)
console.log(`  git push origin HEAD v${version}   # the tag starts the release workflow`)
