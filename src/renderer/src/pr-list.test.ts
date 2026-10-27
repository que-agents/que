import { describe, expect, it } from 'vitest'
import { makePrCheck, makePrThreadEntry, makePullRequest } from '@renderer/testing/fixtures'
import {
  baseLabel,
  checkGroups,
  checksCount,
  checksLine,
  fromSubagent,
  hasNewEntries,
  newestAt,
  orderPrs,
  prCounts,
  prDot
} from './pr-list'

const stack = [
  makePullRequest({ number: 186, state: 'merged', base: 'main', head: 'stale-default' }),
  makePullRequest({ number: 189, state: 'open', base: 'removal-app', head: 'removal-card' }),
  makePullRequest({ number: 190, state: 'draft', base: 'main', head: 'removing-guard' }),
  makePullRequest({ number: 187, state: 'open', base: 'main', head: 'removal-daemon' }),
  makePullRequest({ number: 188, state: 'open', base: 'removal-daemon', head: 'removal-app' }),
  makePullRequest({ number: 185, state: 'closed', base: 'main', head: 'old-try' })
]

describe('orderPrs', () => {
  it('puts open and draft first, then merged and closed, each newest first', () => {
    const { active, settled } = orderPrs(stack)

    expect(active.map((p) => p.number)).toEqual([190, 189, 188, 187])
    expect(settled.map((p) => p.number)).toEqual([186, 185])
  })

  it('leaves its input in the order given', () => {
    const input = [...stack]
    orderPrs(input)

    expect(input.map((p) => p.number)).toEqual([186, 189, 190, 187, 188, 185])
  })
})

describe('prCounts', () => {
  it('counts the open and draft ones, and those of them failing', () => {
    const prs = [
      makePullRequest({ number: 1, state: 'open', checks: 'failing' }),
      makePullRequest({ number: 2, state: 'draft', checks: 'passing' }),
      makePullRequest({ number: 3, state: 'closed', checks: 'failing' })
    ]

    expect(prCounts(prs)).toEqual({ open: 2, failing: 1 })
  })
})

describe('prDot', () => {
  it('rings a draft, takes the checks tone while open, and mutes a settled one', () => {
    expect(prDot(makePullRequest({ state: 'draft', checks: 'failing' }))).toBe('ring')
    expect(prDot(makePullRequest({ state: 'open', checks: 'passing' }))).toBe('good')
    expect(prDot(makePullRequest({ state: 'open', checks: 'failing' }))).toBe('bad')
    expect(prDot(makePullRequest({ state: 'open', checks: 'pending' }))).toBe('busy')
    expect(prDot(makePullRequest({ state: 'open', checks: 'none' }))).toBe('neutral')
    expect(prDot(makePullRequest({ state: 'merged', checks: 'passing' }))).toBe('muted')
    expect(prDot(makePullRequest({ state: 'closed', checks: 'failing' }))).toBe('muted')
  })
})

describe('checksLine', () => {
  const pass = (name: string) => makePrCheck({ name, state: 'passing' })

  it('names the first failing run and counts the passing ones', () => {
    const pr = makePullRequest({
      checkRuns: [
        pass('lint'),
        makePrCheck({ name: 'e2e', state: 'failing' }),
        makePrCheck({ name: 'unit', state: 'failing' }),
        pass('build')
      ]
    })

    expect(checksLine(pr)).toEqual({ tone: 'bad', text: '✗ e2e · 2/4' })
  })

  it('says running while any run is pending, all passing otherwise, skipped runs left out', () => {
    const running = makePullRequest({
      checkRuns: [pass('lint'), makePrCheck({ name: 'e2e', state: 'pending' })]
    })

    const green = makePullRequest({
      checkRuns: [pass('lint'), pass('build'), makePrCheck({ name: 'deploy', state: 'skipped' })]
    })

    expect(checksLine(running)).toEqual({ tone: 'busy', text: 'running 1/2' })
    expect(checksLine(green)).toEqual({ tone: 'good', text: '✓ 2/2' })
  })

  it('is null without runs', () => {
    expect(checksLine(makePullRequest({ checkRuns: [] }))).toBeNull()
  })
})

describe('baseLabel', () => {
  it('names the pull request a stacked one merges into, else the base branch', () => {
    const [, p189, , p187, p188] = stack

    expect(baseLabel(p188, stack)).toBe('#187')
    expect(baseLabel(p189, stack)).toBe('#188')
    expect(baseLabel(p187, stack)).toBe('main')
  })

  it('prefers an open pull request on that branch over a closed one', () => {
    const prs = [
      makePullRequest({ number: 12, state: 'closed', head: 'retry' }),
      makePullRequest({ number: 10, state: 'open', head: 'retry' }),
      makePullRequest({ number: 14, state: 'open', base: 'retry', head: 'retry-cap' })
    ]

    expect(baseLabel(prs[2], prs)).toBe('#10')
  })
})

describe('fromSubagent', () => {
  it('is true when the head is no branch this worktree checked out', () => {
    const branches = ['removal-daemon', 'removal-app']

    expect(fromSubagent(makePullRequest({ head: 'removal-app' }), branches)).toBe(false)
    expect(fromSubagent(makePullRequest({ head: 'removing-guard' }), branches)).toBe(true)
    expect(fromSubagent(makePullRequest({ head: '' }), branches)).toBe(false)
  })
})

describe('checkGroups and checksCount', () => {
  it('lists failing, then running, then skipped, and folds the passing ones', () => {
    const runs = [
      makePrCheck({ name: 'lint', state: 'passing' }),
      makePrCheck({ name: 'deploy', state: 'skipped' }),
      makePrCheck({ name: 'smoke', state: 'pending' }),
      makePrCheck({ name: 'e2e', state: 'failing' }),
      makePrCheck({ name: 'test', state: 'passing' })
    ]

    const { listed, passing } = checkGroups(runs)

    expect(listed.map((c) => c.name)).toEqual(['e2e', 'smoke', 'deploy'])
    expect(passing.map((c) => c.name)).toEqual(['lint', 'test'])
    expect(checksCount(runs)).toEqual({
      failing: 1,
      words: ['1 running', '2 passing', '1 skipped']
    })
  })
})

describe('hasNewEntries and newestAt', () => {
  const older = makePrThreadEntry({ at: '2026-10-14T02:00:00.000Z' })
  const newer = makePrThreadEntry({ at: '2026-10-14T03:00:00.000Z' })

  it('is new when never opened and anything was posted, or posted since', () => {
    expect(hasNewEntries([older], undefined)).toBe(true)
    expect(hasNewEntries([], undefined)).toBe(false)
    expect(hasNewEntries([older, newer], older.at)).toBe(true)
    expect(hasNewEntries([older, newer], newer.at)).toBe(false)
  })

  it('remembers the newest entry as seen', () => {
    expect(newestAt([newer, older])).toBe(newer.at)
    expect(newestAt([])).toBeUndefined()
  })
})
