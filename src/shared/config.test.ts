import { describe, expect, it } from 'vitest'
import { parseConfig, parseRepoConfig, parseWorktreeInclude } from './config'

const env = { queHome: '/Users/dev/.que' }

describe('parseConfig', () => {
  it('falls back to the defaults for an empty file', () => {
    expect(parseConfig('', env)).toEqual({
      ok: true,
      config: {
        worktreeRoot: '/Users/dev/.que/worktrees',
        stallTimeoutMinutes: 5,
        statusPollSeconds: 10,
        repos: {}
      }
    })
  })

  it('reads every field, the repo registry, and ignores unknown keys', () => {
    const r = parseConfig(
      `worktree_root = "/Volumes/work/trees"
stall_timeout_minutes = 0.5
status_poll_seconds = 30
theme = "dark"

[repos.uploader]
path = "/Users/dev/code/uploader"
default_branch = "develop"

[repos.api]
path = "/Users/dev/code/api"
`,
      env
    )

    expect(r).toEqual({
      ok: true,
      config: {
        worktreeRoot: '/Volumes/work/trees',
        stallTimeoutMinutes: 0.5,
        statusPollSeconds: 30,
        repos: {
          uploader: { path: '/Users/dev/code/uploader', defaultBranch: 'develop' },
          api: { path: '/Users/dev/code/api', defaultBranch: undefined }
        }
      }
    })
  })

  it('reports each invalid value by key', () => {
    const r = parseConfig(
      `stall_timeout_minutes = -1
status_poll_seconds = "often"
[repos.uploader]
default_branch = "main"
`,
      env
    )

    expect(r).toEqual({
      ok: false,
      errors: [
        { key: 'stall_timeout_minutes', message: 'must be a positive number' },
        { key: 'status_poll_seconds', message: 'must be a positive number' },
        { key: 'repos.uploader.path', message: 'is required' }
      ]
    })
  })

  it('reports a TOML syntax error without a key', () => {
    const r = parseConfig('stall_timeout_minutes = = 3', env)

    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors[0].key).toBe('')
  })
})

describe('parseRepoConfig', () => {
  it('reads setup, teardown, default branch, and worktree_include merged with .worktreeinclude', () => {
    const r = parseRepoConfig(
      `setup = "npm ci"
teardown = "docker compose down"
default_branch = "trunk"
worktree_include = [".env", "config/local"]
`,
      '# local secrets\n.env\n\n.npmrc\n'
    )

    expect(r).toEqual({
      ok: true,
      config: {
        setup: 'npm ci',
        teardown: 'docker compose down',
        defaultBranch: 'trunk',
        worktreeInclude: ['.env', 'config/local', '.npmrc']
      }
    })
  })

  it('rejects a worktree_include that is not a list of strings', () => {
    expect(parseRepoConfig('worktree_include = ".env"')).toEqual({
      ok: false,
      errors: [{ key: 'worktree_include', message: 'must be a list of strings' }]
    })
  })
})

describe('parseWorktreeInclude', () => {
  it('keeps one path per line, skipping blanks and comments', () => {
    expect(parseWorktreeInclude('.env\n  # comment\n\n  .env.local  \n')).toEqual([
      '.env',
      '.env.local'
    ])
  })
})
