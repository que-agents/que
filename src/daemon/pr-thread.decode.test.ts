import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FAKES_BIN,
  fakeComment,
  fakeLineComment,
  fakeReview,
  setFakePullRequest
} from '../testing/fakes'
import { jsonPages } from './pr-thread'
import { decodeLineComments, decodePrView } from './pr-thread.decode'

describe('pr-thread decoders, on what the fake gh prints', () => {
  let dir: string
  let prsFile: string

  beforeEach(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'que-thread-decode-'))
    prsFile = join(dir, 'prs.json')
    setFakePullRequest(prsFile, 'APP-1432-retry-logic', {
      number: 42,
      url: 'https://github.com/rquellh/que/pull/42',
      comments: [
        fakeComment({ author: 'mara', body: 'Can we cap the retries?', url: 'https://x/c' })
      ],
      reviews: [fakeReview({ author: 'jules', state: 'CHANGES_REQUESTED', body: 'Backoff.' })],
      lineComments: [
        fakeLineComment({
          author: 'jules',
          body: 'Off by one here.',
          path: 'src/retry.ts',
          line: 12,
          hunk: '@@ -10,3 +10,4 @@'
        })
      ]
    })
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const gh = (...args: string[]): string =>
    execFileSync(process.execPath, [join(FAKES_BIN, 'gh'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, QUE_FAKE_GH_PRS: prsFile }
    })

  it('decodes gh pr view --json comments,reviews', () => {
    const view = decodePrView(JSON.parse(gh('pr', 'view', '42', '--json', 'comments,reviews')))

    expect(view).toEqual({
      comments: [
        {
          id: expect.stringMatching(/^IC_\d+$/),
          author: 'mara',
          body: 'Can we cap the retries?',
          createdAt: '2026-10-14T03:00:00Z',
          url: 'https://x/c'
        }
      ],
      reviews: [
        {
          id: expect.stringMatching(/^PRR_\d+$/),
          author: 'jules',
          body: 'Backoff.',
          state: 'CHANGES_REQUESTED',
          submittedAt: '2026-10-14T03:00:00Z',
          url: expect.stringContaining('#pullrequestreview-')
        }
      ]
    })
  })

  it('decodes the paginated line comments list, numeric ids as text', () => {
    const pages = jsonPages(gh('api', 'repos/{owner}/{repo}/pulls/42/comments', '--paginate'))

    expect(decodeLineComments(pages.flat())).toEqual([
      {
        id: expect.stringMatching(/^\d+$/),
        author: 'jules',
        body: 'Off by one here.',
        createdAt: '2026-10-14T03:00:00Z',
        url: expect.stringContaining('#discussion_r'),
        path: 'src/retry.ts',
        line: 12,
        originalLine: 12,
        hunk: '@@ -10,3 +10,4 @@'
      }
    ])
  })
})

describe('decodePrView', () => {
  it('reads null lists (gh prints null for a field it has nothing for) as empty', () => {
    expect(decodePrView({ comments: null, reviews: null })).toEqual({ comments: [], reviews: [] })
  })

  it('reads a missing author or body as null and empty', () => {
    expect(
      decodePrView({ comments: [{ id: 9, author: { login: '' }, body: 42 }], reviews: [] }).comments
    ).toEqual([{ id: '9', author: null, body: '', createdAt: '', url: null }])
  })

  it.each([
    [null],
    ['oops'],
    [[{ comments: [] }]],
    [{ comments: 'x', reviews: { 0: { id: 'PRR_1' } } }],
    [{ comments: [null, 'x', 3, [{ id: 'IC_1' }]] }]
  ])('drops garbage %j', (view) => {
    expect(decodePrView(view)).toEqual({ comments: [], reviews: [] })
  })
})

describe('decodeLineComments', () => {
  it.each([[null], ['line'], [{ id: 1 }], [[null, 7, 'line', [{ id: 1 }]]]])(
    'drops garbage %j',
    (lines) => {
      expect(decodeLineComments(lines)).toEqual([])
    }
  )
})
