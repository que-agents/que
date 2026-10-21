import { describe, expect, it } from 'vitest'
import { isProtectedBranch } from './draft-pr'

describe('isProtectedBranch', () => {
  const protectedBranches = ['main', 'master', 'release']

  it('protects the default branch even when it is not in the list', () => {
    expect(isProtectedBranch('trunk', 'trunk', protectedBranches)).toBe(true)
  })

  it('protects every configured branch', () => {
    expect(isProtectedBranch('release', 'main', protectedBranches)).toBe(true)
    expect(isProtectedBranch('master', 'main', protectedBranches)).toBe(true)
  })

  it('lets a workspace branch through', () => {
    expect(isProtectedBranch('add-retry-logic-to-the-uploader', 'main', protectedBranches)).toBe(
      false
    )
  })
})
