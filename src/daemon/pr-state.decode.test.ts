import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FAKES_BIN, fakeCheckRun, fakeStatusContext, setFakePullRequest } from '../testing/fakes'
import { decodeCheckRollup, decodePullRequest } from './pr-state.decode'

const FIELDS = 'number,url,title,state,isDraft,reviewDecision,statusCheckRollup,mergedAt,updatedAt'

describe('decodePullRequest', () => {
  let dir: string
  let prsFile: string

  beforeEach(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'que-pr-decode-'))
    prsFile = join(dir, 'prs.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  /** What the fake gh prints for `pr list --head <branch> --json ...`. */
  const ghPrList = (branch: string): string =>
    execFileSync(
      process.execPath,
      [join(FAKES_BIN, 'gh'), 'pr', 'list', '--head', branch, '--json', FIELDS],
      { encoding: 'utf8', env: { ...process.env, QUE_FAKE_GH_PRS: prsFile } }
    )

  it('decodes what gh pr list prints, check runs and commit statuses included', () => {
    setFakePullRequest(prsFile, 'APP-1432-retry-logic', {
      number: 42,
      url: 'https://github.com/rquellh/que/pull/42',
      title: 'Add retry logic',
      isDraft: false,
      reviewDecision: 'CHANGES_REQUESTED',
      updatedAt: '2026-10-14T03:30:00Z',
      statusCheckRollup: [
        fakeCheckRun({
          name: 'unit tests',
          conclusion: 'FAILURE',
          detailsUrl: 'https://github.com/rquellh/que/actions/runs/11'
        }),
        fakeStatusContext({ context: 'deploy/preview', state: 'PENDING' })
      ]
    })

    const [item] = JSON.parse(ghPrList('APP-1432-retry-logic')) as unknown[]

    expect(decodePullRequest(item)).toEqual({
      number: 42,
      url: 'https://github.com/rquellh/que/pull/42',
      title: 'Add retry logic',
      state: 'OPEN',
      isDraft: false,
      mergedAt: null,
      reviewDecision: 'CHANGES_REQUESTED',
      updatedAt: '2026-10-14T03:30:00Z',
      checks: [
        {
          kind: 'run',
          name: 'unit tests',
          workflowName: 'CI',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
          detailsUrl: 'https://github.com/rquellh/que/actions/runs/11',
          startedAt: '2026-10-14T02:58:00Z',
          completedAt: '2026-10-14T02:59:21Z'
        },
        {
          kind: 'status',
          name: 'deploy/preview',
          state: 'PENDING',
          targetUrl: null,
          createdAt: '2026-10-14T03:00:00Z'
        }
      ]
    })
  })

  it('reads missing optional fields as empty', () => {
    expect(decodePullRequest({ number: 7, url: 'https://github.com/rquellh/que/pull/7' })).toEqual({
      number: 7,
      url: 'https://github.com/rquellh/que/pull/7',
      title: '',
      state: '',
      isDraft: false,
      mergedAt: null,
      reviewDecision: '',
      updatedAt: null,
      checks: []
    })
  })

  it.each([
    [null],
    ['text'],
    [[{ number: 7, url: 'https://github.com/rquellh/que/pull/7' }]],
    [{ url: 'https://github.com/rquellh/que/pull/7' }],
    [{ number: 1 }],
    [{ number: 1, url: '' }],
    [{ number: '1', url: 'https://github.com/rquellh/que/pull/1' }]
  ])('drops %j', (raw) => {
    expect(decodePullRequest(raw)).toBeNull()
  })
})

describe('decodeCheckRollup', () => {
  it('tells the two shapes apart without __typename', () => {
    expect(
      decodeCheckRollup([
        { name: 'lint', status: 'IN_PROGRESS', conclusion: null },
        { context: 'ci/legacy', state: 'ERROR' }
      ])
    ).toEqual([
      {
        kind: 'run',
        name: 'lint',
        workflowName: null,
        status: 'IN_PROGRESS',
        conclusion: '',
        detailsUrl: null,
        startedAt: null,
        completedAt: null
      },
      { kind: 'status', name: 'ci/legacy', state: 'ERROR', targetUrl: null, createdAt: null }
    ])
  })

  it.each([
    [undefined],
    [null],
    ['text'],
    [{ name: 'build' }],
    [[null, 'x', 3, [], { id: 1 }, { name: 'build' }]]
  ])('drops garbage %j', (rollup) => {
    expect(decodeCheckRollup(rollup)).toEqual([])
  })
})
