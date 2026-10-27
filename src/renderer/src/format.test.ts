import { describe, expect, it } from 'vitest'
import { makePrCheck, makePullRequest } from '@renderer/testing/fixtures'
import { checksLine, prBadge, prDot, prNumberOf, reviewBadge, statusBadge } from './format'

describe('badges', () => {
  it('labels every workspace status with a tone', () => {
    expect(statusBadge('needs_input')).toEqual({ label: 'needs input', tone: 'attention' })
    expect(statusBadge('stuck')).toEqual({ label: 'stuck', tone: 'bad' })
    expect(statusBadge('working').tone).toBe('busy')
  })
})

describe('prBadge', () => {
  it.each([
    [{ state: 'merged' }, 'good', 'PR #41: merged'],
    [{ state: 'closed' }, 'muted', 'PR #41: closed'],
    [{ state: 'closed', checks: 'failing' }, 'muted', 'PR #41: closed, checks failing'],
    [{ state: 'draft' }, 'neutral', 'PR #41: draft'],
    [{ state: 'draft', checks: 'pending' }, 'neutral', 'PR #41: draft, checks pending'],
    [{ state: 'draft', checks: 'failing' }, 'bad', 'PR #41: draft, checks failing'],
    [{ state: 'open', checks: 'failing' }, 'bad', 'PR #41: open, checks failing'],
    [
      { state: 'open', checks: 'failing', review: 'changes_requested' },
      'bad',
      'PR #41: open, checks failing, changes requested'
    ],
    [
      { state: 'open', checks: 'passing', review: 'changes_requested' },
      'attention',
      'PR #41: open, checks passing, changes requested'
    ],
    [
      { state: 'open', checks: 'passing', review: 'approved' },
      'good',
      'PR #41: open, checks passing, approved'
    ],
    [{ state: 'open', checks: 'none', review: 'approved' }, 'good', 'PR #41: open, approved'],
    [
      { state: 'open', checks: 'pending', review: 'approved' },
      'busy',
      'PR #41: open, checks pending, approved'
    ],
    [
      { state: 'open', checks: 'passing', review: 'review_required' },
      'busy',
      'PR #41: open, checks passing, review required'
    ],
    [{ state: 'open', checks: 'passing' }, 'busy', 'PR #41: open, checks passing'],
    [{ state: 'open' }, 'busy', 'PR #41: open']
  ] as const)('%j is %s: "%s"', (overrides, tone, title) => {
    expect(prBadge(makePullRequest(overrides))).toMatchObject({ label: '#41', tone, title })
  })

  it.each([
    [{ state: 'open', checks: 'passing' }, 'open · checks passing'],
    [{ state: 'open', checks: 'pending' }, 'open · checks pending'],
    [{ state: 'open', checks: 'none' }, 'open'],
    [{ state: 'open', checks: 'failing', review: 'changes_requested' }, 'open · checks failing'],
    [{ state: 'open', checks: 'passing', review: 'changes_requested' }, 'changes requested'],
    [{ state: 'open', checks: 'passing', review: 'approved' }, 'open · checks passing'],
    [{ state: 'draft', checks: 'passing' }, 'draft'],
    [{ state: 'merged', checks: 'failing' }, 'merged'],
    [{ state: 'closed', checks: 'passing' }, 'closed']
  ] as const)('%j reads "%s" on the workspace card', (overrides, text) => {
    expect(prBadge(makePullRequest(overrides)).text).toBe(text)
  })
})

describe('prNumberOf', () => {
  it('reads the number off a pull request URL, and nothing without one', () => {
    expect(prNumberOf('https://example.test/rquellh/que/pull/1432')).toBe('1432')
    expect(prNumberOf(null)).toBeUndefined()
    expect(prNumberOf(undefined)).toBeUndefined()
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

describe('reviewBadge', () => {
  it('words each review state and gives it a tone', () => {
    expect(reviewBadge('changes_requested')).toEqual({ label: 'changes requested', tone: 'bad' })
    expect(reviewBadge('approved')).toEqual({ label: 'approved', tone: 'good' })
    expect(reviewBadge('commented')).toEqual({ label: 'commented', tone: 'neutral' })
  })
})
