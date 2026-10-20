// `npm run docs` formats the generated docs with oxfmt after writing them, so
// a --check compares a file with what oxfmt makes of the generated text, not
// with the raw text.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function formatMarkdown(root, text) {
  return execFileSync(join(root, 'node_modules/.bin/oxfmt'), ['--stdin-filepath=generated.md'], {
    cwd: root,
    input: text,
    encoding: 'utf8'
  })
}
