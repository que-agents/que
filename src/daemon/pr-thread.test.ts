import { describe, expect, it } from 'vitest'
import { jsonPages, parsePrThread } from './pr-thread'

const WS = 'ws_01hzx3k9c2qf'
const FETCHED = '2026-10-14T04:00:00.000Z'
const parse = (view: unknown, lines: unknown = []) => parsePrThread(view, lines, WS, 7, FETCHED)

const comment = {
  id: 'IC_kwDOA1',
  author: { login: 'mara' },
  body: 'Can we cap the retries?',
  createdAt: '2026-10-14T03:00:00Z',
  url: 'https://github.com/rquellh/que/pull/7#issuecomment-1'
}
const review = {
  id: 'PRR_kwDOB2',
  author: { login: 'jules' },
  body: 'Needs a backoff.',
  state: 'CHANGES_REQUESTED',
  submittedAt: '2026-10-14T03:10:00Z',
  url: 'https://github.com/rquellh/que/pull/7#pullrequestreview-2'
}
const lineComment = {
  id: 3301,
  user: { login: 'jules' },
  body: 'Off by one here.',
  created_at: '2026-10-14T03:05:00Z',
  html_url: 'https://github.com/rquellh/que/pull/7#discussion_r3301',
  path: 'src/retry.ts',
  line: 12,
  original_line: 10,
  diff_hunk: '@@ -10,3 +10,4 @@\n const retries = 3'
}

describe('parsePrThread', () => {
  it('maps a comment, a review, and a line comment, oldest first', () => {
    expect(parse({ comments: [comment], reviews: [review] }, [lineComment])).toEqual({
      workspaceId: WS,
      number: 7,
      fetchedAt: FETCHED,
      entries: [
        {
          id: 'comment:IC_kwDOA1',
          kind: 'comment',
          author: 'mara',
          body: 'Can we cap the retries?',
          at: '2026-10-14T03:00:00Z',
          url: 'https://github.com/rquellh/que/pull/7#issuecomment-1',
          state: null,
          path: null,
          line: null,
          hunk: null
        },
        {
          id: 'line:3301',
          kind: 'line',
          author: 'jules',
          body: 'Off by one here.',
          at: '2026-10-14T03:05:00Z',
          url: 'https://github.com/rquellh/que/pull/7#discussion_r3301',
          state: null,
          path: 'src/retry.ts',
          line: 12,
          hunk: '@@ -10,3 +10,4 @@\n const retries = 3'
        },
        {
          id: 'review:PRR_kwDOB2',
          kind: 'review',
          author: 'jules',
          body: 'Needs a backoff.',
          at: '2026-10-14T03:10:00Z',
          url: 'https://github.com/rquellh/que/pull/7#pullrequestreview-2',
          state: 'changes_requested',
          path: null,
          line: null,
          hunk: null
        }
      ]
    })
  })

  it.each([
    ['APPROVED', 'approved'],
    ['CHANGES_REQUESTED', 'changes_requested'],
    ['COMMENTED', 'commented'],
    ['DISMISSED', 'dismissed'],
    ['PENDING', 'pending']
  ])('lower-cases review state %s', (state, expected) => {
    expect(parse({ reviews: [{ ...review, state }] }).entries[0].state).toBe(expected)
  })

  it('drops the empty COMMENTED wrapper around line comments, keeps an empty approval', () => {
    const entries = parse({
      reviews: [
        { ...review, id: 'PRR_wrap', state: 'COMMENTED', body: '' },
        { ...review, id: 'PRR_ok', state: 'APPROVED', body: '' },
        { ...review, id: 'PRR_cr', state: 'CHANGES_REQUESTED', body: '' }
      ]
    }).entries

    expect(entries.map((e) => [e.id, e.state])).toEqual([
      ['review:PRR_ok', 'approved'],
      ['review:PRR_cr', 'changes_requested']
    ])
  })

  it('keeps a COMMENTED review that says something', () => {
    expect(parse({ reviews: [{ ...review, state: 'COMMENTED' }] }).entries).toHaveLength(1)
  })

  it('falls back to original_line, then null, for an outdated line comment', () => {
    const entries = parse({}, [
      { ...lineComment, id: 1, line: null },
      { ...lineComment, id: 2, line: null, original_line: null, diff_hunk: null }
    ]).entries

    expect(entries.map((e) => [e.line, e.hunk])).toEqual([
      [10, lineComment.diff_hunk],
      [null, null]
    ])
  })

  it('keeps the input order for entries posted at the same time', () => {
    const at = '2026-10-14T03:00:00Z'
    const entries = parse(
      {
        comments: [
          { ...comment, id: 'c2', createdAt: at },
          { ...comment, id: 'c1', createdAt: '2026-10-14T02:00:00Z' }
        ],
        reviews: [{ ...review, id: 'r1', submittedAt: at }]
      },
      [{ ...lineComment, id: 5, created_at: at }]
    ).entries

    expect(entries.map((e) => e.id)).toEqual(['comment:c1', 'comment:c2', 'review:r1', 'line:5'])
  })

  it('prefixes ids by kind so equal GitHub ids never collide', () => {
    const entries = parse({ comments: [{ ...comment, id: 9 }], reviews: [{ ...review, id: 9 }] }, [
      { ...lineComment, id: 9 }
    ]).entries

    expect(entries.map((e) => e.id).sort()).toEqual(['comment:9', 'line:9', 'review:9'])
  })

  it('names a missing author unknown and a missing body empty', () => {
    const entries = parse(
      {
        comments: [{ ...comment, author: null, body: undefined }],
        reviews: [{ ...review, author: {}, body: null, state: 'APPROVED' }]
      },
      [{ ...lineComment, user: 'ghost', body: 42 }]
    ).entries

    expect(entries.map((e) => [e.kind, e.author, e.body])).toEqual([
      ['comment', 'unknown', ''],
      ['line', 'unknown', ''],
      ['review', 'unknown', '']
    ])
  })

  it.each([
    [null, null],
    ['oops', 'oops'],
    [[comment], { comments: 'x' }],
    [{ comments: [null, 'x', 3, [comment]], reviews: { 0: review } }, [null, 7, 'line']]
  ])('skips garbage view %j and line comments %j', (view, lines) => {
    expect(parse(view, lines).entries).toEqual([])
  })
})

describe('jsonPages', () => {
  it('splits pages printed back to back, brackets inside strings included', () => {
    expect(jsonPages('[{"body":"a ][ b"}]\n[{"body":"c \\" ]["}]')).toEqual([
      [{ body: 'a ][ b' }],
      [{ body: 'c " ][' }]
    ])
  })

  it('reads one page, and nothing as no pages', () => {
    expect(jsonPages('[]\n')).toEqual([[]])
    expect(jsonPages('')).toEqual([])
  })

  it.each([['[1, 2'], ['nope'], ['[] x']])('rejects %j', (text) => {
    expect(() => jsonPages(text)).toThrow('not JSON')
  })
})
