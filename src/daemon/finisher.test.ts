import { describe, expect, it } from 'vitest'
import { isProtectedBranch, prBody } from './finisher'

describe('isProtectedBranch', () => {
  const protectedBranches = ['main', 'master', 'release']

  it('protects the default branch even when it is not in the list', () => {
    expect(isProtectedBranch('trunk', 'trunk', protectedBranches)).toBe(true)
  })

  it('protects every configured branch', () => {
    expect(isProtectedBranch('release', 'main', protectedBranches)).toBe(true)
    expect(isProtectedBranch('master', 'main', protectedBranches)).toBe(true)
  })

  it('lets a task branch through', () => {
    expect(isProtectedBranch('add-retry-logic-to-the-uploader', 'main', protectedBranches)).toBe(
      false
    )
  })
})

describe('prBody', () => {
  it("is the agent's summary and a trailing line naming the workspace", () => {
    expect(prBody('Added exponential backoff.\n', 'add-retry-logic')).toBe(
      'Added exponential backoff.\n\nOpened by que from workspace add-retry-logic.\n'
    )
  })

  it('is just the trailing line without a summary', () => {
    expect(prBody(null, 'add-retry-logic')).toBe('Opened by que from workspace add-retry-logic.\n')
  })
})
