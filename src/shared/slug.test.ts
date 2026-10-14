import { describe, expect, it } from 'vitest'
import { slugify, workspaceSlug } from './slug'

describe('slugify', () => {
  it.each([
    ['HA-1432 retry logic', 'ha-1432-retry-logic'],
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
    expect(workspaceSlug('HA-1432 retry logic')).toBe('ha-1432-retry-logic')
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
