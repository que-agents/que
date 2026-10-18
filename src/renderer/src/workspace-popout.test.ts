import { describe, expect, it } from 'vitest'
import { makePrCheck, makePullRequest } from '@renderer/testing/fixtures'
import { firstFailingCheck, tildePath } from './workspace-popout'

describe('tildePath', () => {
  it('writes ~ for the home directory and leaves other paths alone', () => {
    expect(tildePath('/Users/dev/w/uploader/app-1432-retry-logic', '/Users/dev')).toBe(
      '~/w/uploader/app-1432-retry-logic'
    )
    expect(tildePath('/Users/dev', '/Users/dev/')).toBe('~')
    expect(tildePath('/Users/devon/w/uploader', '/Users/dev')).toBe('/Users/devon/w/uploader')
    expect(tildePath('/Volumes/work/uploader', '/Users/dev')).toBe('/Volumes/work/uploader')
    expect(tildePath('/Users/dev/w/uploader', null)).toBe('/Users/dev/w/uploader')
  })
})

describe('firstFailingCheck', () => {
  it('names the first failing run while the checks fail, and nothing otherwise', () => {
    const runs = [
      makePrCheck({ name: 'lint', state: 'passing' }),
      makePrCheck({ name: 'e2e', state: 'failing' }),
      makePrCheck({ name: 'unit', state: 'failing' })
    ]

    expect(firstFailingCheck(makePullRequest({ checks: 'failing', checkRuns: runs }))).toBe('e2e')
    expect(firstFailingCheck(makePullRequest({ checks: 'passing', checkRuns: runs }))).toBeNull()
    expect(firstFailingCheck(makePullRequest({ checks: 'failing', checkRuns: [] }))).toBeNull()
  })
})
