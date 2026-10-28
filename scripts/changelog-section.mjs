// `node scripts/changelog-section.mjs <version>`: prints the notes CHANGELOG.md
// holds for that version, without the `## [<version>]` heading or the link
// definitions, for the release workflow to use as the release notes. Exits 1
// when the version has no section, or an empty one.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LINK_DEFINITION = /^\[[^\]]+\]:\s/

/**
 * The body of `## [<version>]` in a Keep a Changelog file, trimmed: from the line
 * after the heading up to the next `## ` heading (or the end of the file), with
 * link definition lines left out. Undefined when the section is missing or empty.
 */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`))

  if (start === -1) return undefined

  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))

  const body = (end === -1 ? rest : rest.slice(0, end))
    .filter((line) => !LINK_DEFINITION.test(line))
    .join('\n')
    .trim()

  return body === '' ? undefined : body
}

function main(argv) {
  const version = (argv[0] ?? '').replace(/^v/, '')

  if (version === '') {
    console.error('usage: node scripts/changelog-section.mjs <version>')

    return 2
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const section = changelogSection(readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'), version)

  if (section === undefined) {
    console.error(`CHANGELOG.md has no notes under "## [${version}]". Was [Unreleased] folded?`)

    return 1
  }

  process.stdout.write(`${section}\n`)

  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
