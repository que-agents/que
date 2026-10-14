// A real git repo for tests: two commits on main and a que.toml.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { join } from 'node:path'

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'que test',
  GIT_AUTHOR_EMAIL: 'test@que.invalid',
  GIT_COMMITTER_NAME: 'que test',
  GIT_COMMITTER_EMAIL: 'test@que.invalid',
  GIT_AUTHOR_DATE: '2026-10-01T09:00:00Z',
  GIT_COMMITTER_DATE: '2026-10-01T09:00:00Z',
  GIT_CONFIG_NOSYSTEM: '1'
}

/** Creates `<dir>/uploader` as a git repo on `main` and returns its path. */
export function makeTempRepo(dir: string): string {
  const repo = join(dir, 'uploader')
  fs.mkdirSync(repo, { recursive: true })
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: repo,
      env: { ...process.env, ...GIT_ENV },
      stdio: 'ignore'
    })
  }
  git('init', '-b', 'main')
  fs.writeFileSync(join(repo, 'README.md'), '# uploader\n')
  git('add', '.')
  git('commit', '-m', 'Initial commit')
  fs.writeFileSync(join(repo, 'que.toml'), 'setup = "true"\n')
  git('add', '.')
  git('commit', '-m', 'Add que.toml')
  return repo
}
