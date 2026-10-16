// The deterministic repo fixture: the same two-commit repo with a que.toml on
// every run (fixed author and dates, so commit hashes are stable too).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'que e2e',
  GIT_AUTHOR_EMAIL: 'e2e@que.invalid',
  GIT_COMMITTER_NAME: 'que e2e',
  GIT_COMMITTER_EMAIL: 'e2e@que.invalid',
  GIT_AUTHOR_DATE: '2026-10-01T09:00:00Z',
  GIT_COMMITTER_DATE: '2026-10-01T09:00:00Z',
  GIT_CONFIG_NOSYSTEM: '1'
}

/**
 * Two commits on main and a que.toml with a trivial setup command. With
 * `origin`, a bare clone next to it becomes `origin`, so the finisher's
 * pushes land somewhere real.
 */
export function makeRepo(opts: { origin?: boolean } = {}): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'que-e2e-repo-'))

  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      env: GIT_ENV,
      stdio: 'ignore'
    })

  git('init', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), '# uploader\n')
  git('add', '.')
  git('commit', '-m', 'Initial commit')
  writeFileSync(join(dir, 'que.toml'), 'setup = "true"\n')
  git('add', '.')
  git('commit', '-m', 'Add que.toml')

  if (opts.origin) {
    const bare = `${dir}.git`
    execFileSync('git', ['clone', '--bare', '--quiet', dir, bare], {
      env: GIT_ENV,
      stdio: 'ignore'
    })
    git('remote', 'add', 'origin', bare)
    git('fetch', '--quiet', 'origin')
  }

  return dir
}
