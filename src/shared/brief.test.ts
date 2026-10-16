import { describe, expect, it } from 'vitest'
import { briefFile, titleOf } from './brief'

describe('titleOf', () => {
  it("is the brief's first non-empty line, trimmed", () => {
    expect(titleOf('\n  Add retry logic to the uploader  \nUse exponential backoff.')).toBe(
      'Add retry logic to the uploader'
    )
  })

  it('is cut to 80 characters', () => {
    const title = titleOf(`Refactor ${'the upload queue '.repeat(10)}`)

    expect(title).toHaveLength(80)
    expect(title.endsWith('…')).toBe(true)
  })

  it('is empty for a blank brief', () => {
    expect(titleOf('  \n\n ')).toBe('')
  })
})

describe('briefFile', () => {
  it('heads the brief with its title', () => {
    expect(
      briefFile('Fix the flaky upload test', 'Fix the flaky upload test\n\nRaise it.\n\n')
    ).toBe('# Fix the flaky upload test\n\nFix the flaky upload test\n\nRaise it.\n')
  })

  it('keeps a brief that already starts with a heading as it is', () => {
    const ticket = '\n# APP-1432 Add retry logic\n\n## Description\n\nRetry three times.'

    expect(briefFile('APP-1432 Add retry logic', ticket)).toBe(`${ticket}\n`)
  })

  it('still heads a brief whose first line is a lower heading', () => {
    expect(briefFile('Notes', '## Notes\nsome')).toBe('# Notes\n\n## Notes\nsome\n')
  })
})
