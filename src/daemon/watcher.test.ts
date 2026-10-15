import { describe, expect, it } from 'vitest'
import { isGitdirChange, isWorktreeChange, parseGitdirPointer } from './watcher'

describe('isWorktreeChange', () => {
  it.each([
    ['src/a.ts', true],
    ['node_modules/x', true],
    ['.gitignore', true],
    ['.github/workflows/ci.yml', true],
    ['.git', false],
    ['.git/index', false]
  ])('%s → %s', (rel, expected) => {
    expect(isWorktreeChange(rel)).toBe(expected)
  })
})

describe('isGitdirChange', () => {
  it.each([
    ['HEAD', true],
    ['index', true],
    ['ORIG_HEAD', true],
    ['logs/HEAD', true],
    ['refs/heads/app-1601-watch', true],
    ['packed-refs', true],
    ['objects/ab/cd', false],
    ['COMMIT_EDITMSG', false],
    ['index.lock', false],
    ['worktrees/app-1601-watch/HEAD', false]
  ])('%s → %s', (rel, expected) => {
    expect(isGitdirChange(rel)).toBe(expected)
  })
})

describe('parseGitdirPointer', () => {
  it('reads an absolute gitdir', () => {
    expect(
      parseGitdirPointer(
        'gitdir: /Users/dev/uploader/.git/worktrees/app-1601-watch\n',
        '/Users/dev/.que/worktrees/app-1601-watch'
      )
    ).toBe('/Users/dev/uploader/.git/worktrees/app-1601-watch')
  })

  it('resolves a relative gitdir against the worktree', () => {
    expect(
      parseGitdirPointer(
        'gitdir: ../uploader/.git/worktrees/app-1601-watch\n',
        '/Users/dev/app-1601-watch'
      )
    ).toBe('/Users/dev/uploader/.git/worktrees/app-1601-watch')
  })

  it('answers null for text that is not a pointer', () => {
    expect(parseGitdirPointer('[core]\n\tbare = false\n', '/Users/dev/app-1601-watch')).toBeNull()
  })
})
