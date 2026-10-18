import { describe, expect, it } from 'vitest'
import { makePrCheck, makePullRequest } from '@renderer/testing/fixtures'
import { firstFailingCheck, newestPrsFirst, prStateText, tildePath } from './workspace-popout'

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

describe('prStateText', () => {
  it('says the state in the order its tone is chosen', () => {
    expect(prStateText(makePullRequest({ state: 'open', checks: 'passing' }))).toBe(
      'open · checks passing'
    )
    expect(prStateText(makePullRequest({ state: 'open', checks: 'pending' }))).toBe(
      'open · checks pending'
    )
    expect(prStateText(makePullRequest({ state: 'open', checks: 'none' }))).toBe('open')
    expect(
      prStateText(
        makePullRequest({ state: 'open', checks: 'failing', review: 'changes_requested' })
      )
    ).toBe('open · checks failing')
    expect(
      prStateText(
        makePullRequest({ state: 'open', checks: 'passing', review: 'changes_requested' })
      )
    ).toBe('changes requested')
    expect(prStateText(makePullRequest({ state: 'draft', checks: 'passing' }))).toBe('draft')
    expect(prStateText(makePullRequest({ state: 'merged', checks: 'failing' }))).toBe('merged')
    expect(prStateText(makePullRequest({ state: 'closed', checks: 'passing' }))).toBe('closed')
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

describe('newestPrsFirst', () => {
  it('puts the highest number first without touching its input', () => {
    const prs = [1, 3, 2].map((number) => makePullRequest({ number }))

    expect(newestPrsFirst(prs).map((p) => p.number)).toEqual([3, 2, 1])
    expect(prs.map((p) => p.number)).toEqual([1, 3, 2])
  })
})
