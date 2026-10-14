// A real git repo for tests: two commits on main and a que.toml.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { dirname, join } from 'node:path'

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'que test',
  GIT_AUTHOR_EMAIL: 'test@que.invalid',
  GIT_COMMITTER_NAME: 'que test',
  GIT_COMMITTER_EMAIL: 'test@que.invalid',
  GIT_AUTHOR_DATE: '2026-10-01T09:00:00Z',
  GIT_COMMITTER_DATE: '2026-10-01T09:00:00Z',
  GIT_CONFIG_NOSYSTEM: '1'
}

/** Runs git in `cwd` with a fixed identity and returns trimmed stdout. */
export function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env: { ...process.env, ...GIT_ENV },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
}

export interface TempRepoOptions {
  /** Directory name under `dir`. Default `uploader`. */
  name?: string
  /** Initial branch. Default `main`. */
  branch?: string
  /** que.toml contents. Default `setup = "true"`. */
  queToml?: string
  /** Gitignored files to create in the checkout (path → contents). */
  ignored?: Record<string, string>
}

/** Creates `<dir>/uploader` as a git repo on `main` and returns its path. */
export function makeTempRepo(dir: string, opts: TempRepoOptions = {}): string {
  const repo = join(dir, opts.name ?? 'uploader')
  fs.mkdirSync(repo, { recursive: true })
  const git = (...args: string[]): void => {
    gitIn(repo, ...args)
  }
  git('init', '-b', opts.branch ?? 'main')
  fs.writeFileSync(join(repo, 'README.md'), '# uploader\n')
  git('add', '.')
  git('commit', '-m', 'Initial commit')
  const ignored = Object.keys(opts.ignored ?? {})
  fs.writeFileSync(join(repo, 'que.toml'), opts.queToml ?? 'setup = "true"\n')
  if (ignored.length > 0) fs.writeFileSync(join(repo, '.gitignore'), `${ignored.join('\n')}\n`)
  git('add', '.')
  git('commit', '-m', 'Add que.toml')
  for (const [path, contents] of Object.entries(opts.ignored ?? {})) {
    fs.mkdirSync(dirname(join(repo, path)), { recursive: true })
    fs.writeFileSync(join(repo, path), contents)
  }
  return repo
}

/**
 * Gives `repo` an `origin`: a bare clone next to it (`<repo>.git`), fetched so
 * `origin/<branch>` exists. Pushes from worktrees land there for real.
 */
export function addBareOrigin(repo: string): string {
  const bare = `${repo}.git`
  gitIn(dirname(repo), 'clone', '--bare', '--quiet', repo, bare)
  gitIn(repo, 'remote', 'add', 'origin', bare)
  gitIn(repo, 'fetch', '--quiet', 'origin')
  return bare
}
