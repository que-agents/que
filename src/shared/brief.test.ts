import { describe, expect, it } from 'vitest'
import { nameFromTitle, titleOf } from './brief'

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

describe('nameFromTitle', () => {
  it('slugs the title', () => {
    expect(nameFromTitle('Add retry logic to the uploader')).toBe('add-retry-logic-to-the-uploader')
  })

  it('cuts the slug to 48 characters without a trailing hyphen or dot', () => {
    expect(
      nameFromTitle('Refactor the upload queue so that retries back off exponentially per host')
    ).toBe('refactor-the-upload-queue-so-that-retries-back-o')
    expect(nameFromTitle('Fix the flaky test in uploader.spec.ts...')).toBe(
      'fix-the-flaky-test-in-uploader.spec.ts'
    )
    expect(nameFromTitle(`${'a'.repeat(47)} b`)).toBe('a'.repeat(47))
  })

  it('drops leading punctuation', () => {
    expect(nameFromTitle('— Speed up the diff view')).toBe('speed-up-the-diff-view')
  })

  it('is null when the title has no usable characters', () => {
    expect(nameFromTitle('✨🚀')).toBeNull()
    expect(nameFromTitle('')).toBeNull()
  })
})
