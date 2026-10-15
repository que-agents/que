// Paths to the subprocess fakes and readers for their call logs.
import fs from 'node:fs'
import { resolve } from 'node:path'

export const REPO_ROOT = resolve(__dirname, '../..')
export const FAKES_BIN = resolve(REPO_ROOT, 'tests/fakes/bin')
/** Another tool's claude wrapper (tests/fakes/wrappers/claude), for PATH ahead of the fakes. */
export const FAKE_WRAPPERS = resolve(REPO_ROOT, 'tests/fakes/wrappers')

/** One recorded invocation of a fake `claude`, `gh`, or `code`. */
export interface FakeCall {
  argv: string[]
  cwd: string
  /** Recorded by the fake `claude` (and `caffeinate`). */
  pid?: number
  /** Recorded by the fake `claude`: the CLAUDE*, TERM* and QUE_* variable names it saw. */
  env?: string[]
  ts: string
}

/** Reads QUE_FAKE_CLAUDE_LOG / QUE_FAKE_GH_LOG / QUE_FAKE_CODE_LOG back; [] if nothing ran. */
export function readFakeLog(path: string): FakeCall[] {
  if (!fs.existsSync(path)) return []
  return fs
    .readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FakeCall)
}

/** One run of tests/fakes/wrappers/claude: its pid and the arguments it passed on. */
export interface WrapperRun {
  pid: number
  args: string
}

/** Reads QUE_FAKE_WRAPPER_LOG back; [] if the wrapper never ran. */
export function readWrapperLog(path: string): WrapperRun[] {
  if (!fs.existsSync(path)) return []
  return fs
    .readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [pid, args = ''] = line.split('\t')
      return { pid: Number(pid), args }
    })
}

/** One entry of the fake gh's pull request file ($QUE_FAKE_GH_PRS), as `gh pr list` reports it. */
export interface FakePr {
  number: number
  url: string
  title: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  headRefName?: string
  reviewDecision: string
  statusCheckRollup: Array<Record<string, unknown>>
  mergedAt: string | null
}

/** Reads the fake gh's pull requests, keyed by head branch; {} when there are none. */
export function readFakePullRequests(file: string): Record<string, FakePr> {
  if (!fs.existsSync(file)) return {}
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, FakePr>
}

/** Merges `patch` into the branch's fake pull request, creating it with defaults first. */
export function setFakePullRequest(file: string, branch: string, patch: Partial<FakePr>): void {
  const all = readFakePullRequests(file)
  const existing: Partial<FakePr> = all[branch] ?? {}
  all[branch] = {
    number: 1,
    url: 'https://github.com/rquellh/que/pull/1',
    title: 'Add retry logic',
    state: 'OPEN',
    isDraft: true,
    headRefName: branch,
    reviewDecision: '',
    statusCheckRollup: [],
    mergedAt: null,
    ...existing,
    ...patch
  }
  fs.writeFileSync(file, JSON.stringify(all, null, 2))
}

/** One issue as `acli jira workitem search/view --json` prints it. */
export interface FakeIssue {
  key: string
  id: string
  self: string
  fields: {
    summary: string
    status: { name: string; statusCategory: { key: string } }
    priority: { name: string } | null
    issuetype: { name: string }
    assignee: { displayName: string } | null
    project: { key: string; name: string }
    labels: string[]
    updated: string
    description: unknown
  }
}

/** An issue in acli's shape; `overrides` replace top-level keys and merge into `fields`. */
export function makeFakeIssue(
  overrides: Partial<Omit<FakeIssue, 'fields'>> & { fields?: Partial<FakeIssue['fields']> } = {}
): FakeIssue {
  const { fields, ...top } = overrides
  const key = top.key ?? 'APP-1432'
  return {
    key,
    id: '10432',
    self: 'https://example.atlassian.net/rest/api/3/issue/10432',
    ...top,
    fields: {
      summary: 'Add retry logic to the uploader',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'Medium' },
      issuetype: { name: 'Story' },
      assignee: { displayName: 'Test User' },
      project: { key: 'APP', name: 'Uploader' },
      labels: [],
      updated: '2026-10-13T09:30:00.000+0000',
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Uploads fail on flaky networks and are never retried.' }
            ]
          },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance' }] },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Retry three times' }] }
                ]
              },
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Back off between tries' }] }
                ]
              }
            ]
          },
          {
            type: 'codeBlock',
            attrs: { language: 'ts' },
            content: [{ type: 'text', text: 'await retry(() => upload(file))' }]
          }
        ]
      },
      ...fields
    }
  }
}

/** Writes the fake acli's issue file ($QUE_FAKE_ACLI_TICKETS). */
export function writeFakeTickets(file: string, issues: FakeIssue[]): void {
  fs.writeFileSync(file, JSON.stringify(issues, null, 2))
}
