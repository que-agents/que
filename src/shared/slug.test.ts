import { describe, expect, it } from 'vitest'
import { cappedSlug, slugify, workspaceSlug } from './slug'

describe('slugify', () => {
  it.each([
    ['APP-1432 retry logic', 'app-1432-retry-logic'],
    ['quiet_board  v2', 'quiet-board-v2'],
    ['  Fix: uploader (retries)! ', 'fix-uploader-retries'],
    ['release/2.1', 'release2.1'],
    ['émoji ✓ name', 'moji--name']
  ])('slugs %j to %j', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })
})

describe('workspaceSlug', () => {
  it('accepts names that slug to a valid workspace name', () => {
    expect(workspaceSlug('APP-1432 retry logic')).toBe('app-1432-retry-logic')
    expect(workspaceSlug('a'.repeat(64))).toBe('a'.repeat(64))
  })

  it.each([
    ['', 'empty'],
    ['!!!', 'nothing left'],
    ['-leading-dash', 'not starting with a letter or digit'],
    ['.hidden', 'starting with a dot'],
    ['a'.repeat(65), 'longer than 64']
  ])('rejects %j (%s)', (input) => {
    expect(workspaceSlug(input)).toBeNull()
  })
})

describe('cappedSlug', () => {
  it('cuts the slug to the cap and trims it to a letter or digit at both ends', () => {
    expect(cappedSlug('APP-1432 retry logic', 64)).toBe('app-1432-retry-logic')
    expect(cappedSlug('APP-1432 retry logic', 9)).toBe('app-1432')
    expect(cappedSlug('-- Fix the uploader.', 64)).toBe('fix-the-uploader')
    expect(cappedSlug('✓ ✓', 64)).toBe('')
  })
})
