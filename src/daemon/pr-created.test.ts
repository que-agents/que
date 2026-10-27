import { describe, expect, it } from 'vitest'
import type { HookEvent } from '@shared/protocol'
import { makeHookEvent } from '../testing/fixtures'
import { createdPullRequests, githubRepo, runsPrCreate } from './pr-created'

const ORIGIN = 'git@github.com:rquellh/que.git'
const URL_88 = 'https://github.com/rquellh/que/pull/88'

/** A Bash PostToolUse as Claude Code reports it: the command, and what it printed. */
const bash = (command: string, response: unknown, extra: Partial<HookEvent> = {}): HookEvent =>
  makeHookEvent('PostToolUse', {
    tool_name: 'Bash',
    tool_input: { command, description: 'Open the pull request' },
    tool_response: response,
    ...extra
  })

describe('runsPrCreate', () => {
  it.each([
    'gh pr create --title "Retry uploads" --body "Adds backoff"',
    'gh pr create --draft --fill',
    'gh pr create --base APP-1432-retry-logic --head APP-1433-backoff --fill',
    'gh pr create --repo rquellh/que --fill',
    'git push -u origin HEAD && gh pr create --fill',
    'git push -u origin HEAD; gh  pr  create --fill',
    'cd /Users/dev/src/que && /opt/homebrew/bin/gh pr create --fill',
    '(gh pr create --fill)'
  ])('sees %s', (command) => {
    expect(runsPrCreate(command)).toBe(true)
  })

  it.each([
    'gh pr view 88 --json url',
    'gh pr list --head APP-1432-retry-logic',
    'gh pr created-at',
    'echo "remember to run fakegh pr create later"',
    'my-gh pr create --fill'
  ])('ignores %s', (command) => {
    expect(runsPrCreate(command)).toBe(false)
  })
})

describe('githubRepo', () => {
  it.each([
    ['https://github.com/rquellh/que.git', 'rquellh', 'que'],
    ['https://github.com/rquellh/que', 'rquellh', 'que'],
    ['https://x-access-token@github.com/rquellh/que.git', 'rquellh', 'que'],
    ['git@github.com:rquellh/que.git', 'rquellh', 'que'],
    ['ssh://git@github.com/rquellh/que.git', 'rquellh', 'que'],
    ['git@github.com:rquellh/que.js.git', 'rquellh', 'que.js']
  ])('reads %s', (remote, owner, name) => {
    expect(githubRepo(remote)).toEqual({ owner, name })
  })

  it.each(['/Users/dev/src/uploader.git', 'https://gitlab.com/rquellh/que.git', ''])(
    'is null for %j',
    (remote) => {
      expect(githubRepo(remote)).toBeNull()
    }
  )
})

describe('createdPullRequests', () => {
  it('finds the URL gh printed to stdout', () => {
    const event = bash('gh pr create --fill', {
      stdout: `${URL_88}\n`,
      stderr: '',
      interrupted: false
    })

    expect(createdPullRequests(event, ORIGIN)).toEqual([URL_88])
  })

  it('finds it on stderr, or in a response that is a plain string', () => {
    const onStderr = bash('gh pr create --draft --fill', {
      stdout: '',
      stderr: `\nCreating draft pull request for APP-1433-backoff into main in rquellh/que\n\n${URL_88}\n`
    })

    expect(createdPullRequests(onStderr, ORIGIN)).toEqual([URL_88])
    expect(createdPullRequests(bash('gh pr create --fill', `${URL_88}\n`), ORIGIN)).toEqual([
      URL_88
    ])
  })

  it('finds it after a chain, with --repo, and from a subagent', () => {
    const event = bash(
      'git push -u origin HEAD && gh pr create --repo rquellh/que --base APP-1432-retry-logic --fill',
      { stdout: `branch 'APP-1433-backoff' set up to track 'origin/APP-1433-backoff'.\n${URL_88}` },
      { agent_id: 'a3f9c2e1', agent_type: 'general-purpose' }
    )

    expect(createdPullRequests(event, 'https://github.com/rquellh/que.git')).toEqual([URL_88])
  })

  it("matches the origin's owner and name in any case, and lists each URL once", () => {
    const upper = 'https://github.com/RQuellh/Que/pull/88'
    const event = bash('gh pr create --fill', { stdout: `${upper}\n${upper}\n` })

    expect(createdPullRequests(event, ORIGIN)).toEqual([upper])
  })

  it("ignores another repository's pull request", () => {
    const event = bash('gh pr create --repo rquellh/uploader --fill', {
      stdout: 'https://github.com/rquellh/uploader/pull/12\n'
    })

    expect(createdPullRequests(event, ORIGIN)).toEqual([])
  })

  it('ignores a command that did not create one, another tool, another event, and a non-GitHub origin', () => {
    expect(
      createdPullRequests(bash('gh pr view 88 --json url', { stdout: URL_88 }), ORIGIN)
    ).toEqual([])
    expect(
      createdPullRequests(
        makeHookEvent('PostToolUse', {
          tool_name: 'Read',
          tool_input: { file_path: '/Users/dev/notes.md' },
          tool_response: URL_88
        }),
        ORIGIN
      )
    ).toEqual([])
    expect(
      createdPullRequests(
        makeHookEvent('PreToolUse', {
          tool_name: 'Bash',
          tool_input: { command: 'gh pr create --fill' }
        }),
        ORIGIN
      )
    ).toEqual([])
    expect(
      createdPullRequests(
        bash('gh pr create --fill', { stdout: URL_88 }),
        '/Users/dev/src/uploader.git'
      )
    ).toEqual([])
  })
})
