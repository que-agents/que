import { describe, expect, it } from 'vitest'
import { appendNew, reflogBranches, renameBranch, withBranch } from './branch-history'

// As `git reflog show --format=%gs HEAD` prints it: newest first.
const reflog = (...newestFirst: string[]): string => newestFirst.join('\n')

describe('reflogBranches', () => {
  it('lists both sides of each checkout, oldest first, each once', () => {
    const out = reflog(
      'checkout: moving from APP-1433-backoff to APP-1432-retry-logic',
      'commit: Retry on 503',
      'checkout: moving from APP-1432-retry-logic to APP-1433-backoff',
      'reset: moving to HEAD'
    )

    expect(reflogBranches(out)).toEqual(['APP-1432-retry-logic', 'APP-1433-backoff'])
  })

  it('leaves out detached checkouts: a sha, HEAD, and revision expressions', () => {
    const out = reflog(
      'checkout: moving from 3f9c2a17b0d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8 to fix/upload-timeout',
      'checkout: moving from HEAD~2 to 3f9c2a17b0d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8',
      'checkout: moving from APP-1432-retry-logic to HEAD~2'
    )

    expect(reflogBranches(out)).toEqual(['APP-1432-retry-logic', 'fix/upload-timeout'])
  })

  it('follows a rename to the new name', () => {
    const out = reflog(
      'Branch: renamed refs/heads/wip-backoff to refs/heads/APP-1433-backoff',
      'checkout: moving from APP-1432-retry-logic to wip-backoff'
    )

    expect(reflogBranches(out)).toEqual(['APP-1432-retry-logic', 'APP-1433-backoff'])
  })

  it('is empty for a worktree that never checked out another branch', () => {
    expect(reflogBranches('')).toEqual([])
    expect(reflogBranches(reflog('commit: Retry on 503', 'reset: moving to HEAD'))).toEqual([])
  })
})

describe('withBranch', () => {
  it('appends a new branch and keeps a known one where it is, leaving its input untouched', () => {
    const list = ['APP-1432-retry-logic', 'APP-1433-backoff']
    const before = [...list]

    expect(withBranch(list, 'APP-1434-jitter')).toEqual([...list, 'APP-1434-jitter'])
    expect(withBranch(list, 'APP-1432-retry-logic')).toEqual(list)
    expect(list).toEqual(before)
  })
})

describe('appendNew', () => {
  it('appends the items not already present, in order and once each', () => {
    const urls = ['https://github.com/rquellh/que/pull/88']

    expect(
      appendNew(urls, [
        'https://github.com/rquellh/que/pull/91',
        'https://github.com/rquellh/que/pull/88',
        'https://github.com/rquellh/que/pull/91'
      ])
    ).toEqual(['https://github.com/rquellh/que/pull/88', 'https://github.com/rquellh/que/pull/91'])
    expect(urls).toEqual(['https://github.com/rquellh/que/pull/88'])
  })
})

describe('renameBranch', () => {
  it('renames in place, or drops the old name when the new one is already listed', () => {
    const list = ['APP-1432-retry-logic', 'wip-backoff', 'APP-1434-jitter']

    expect(renameBranch(list, 'wip-backoff', 'APP-1433-backoff')).toEqual([
      'APP-1432-retry-logic',
      'APP-1433-backoff',
      'APP-1434-jitter'
    ])
    expect(renameBranch(list, 'wip-backoff', 'APP-1434-jitter')).toEqual([
      'APP-1432-retry-logic',
      'APP-1434-jitter'
    ])
  })
})
