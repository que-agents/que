// The generated docs go through oxfmt before they are written or checked, so
// a --check compares a file with exactly what a write would produce.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function formatMarkdown(root, text) {
  return execFileSync(join(root, 'node_modules/.bin/oxfmt'), ['--stdin-filepath=generated.md'], {
    cwd: root,
    input: text,
    encoding: 'utf8'
  })
}
