import { describe, expect, it } from 'vitest'
import { newLineNumbers } from './diff'

describe('newLineNumbers', () => {
  it('numbers the added and context lines from each hunk head, and nothing else', () => {
    const patch = [
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1,3 +1,4 @@',
      ' # uploader',
      '-Retries once.',
      '+Retries with backoff.',
      '+Backoff caps at 30s.',
      ' ',
      '@@ -40,2 +41,2 @@ export function put() {',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      '\\ No newline at end of file',
      ''
    ].join('\n')

    expect(newLineNumbers(patch)).toEqual([
      null,
      null,
      null,
      null,
      1,
      null,
      2,
      3,
      4,
      null,
      41,
      null,
      42,
      null
    ])
  })

  it('reads a one-line hunk head without a count', () => {
    expect(newLineNumbers('@@ -0,0 +1 @@\n+only line\n')).toEqual([null, 1])
  })
})
