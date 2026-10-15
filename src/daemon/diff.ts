// What a workspace changed against its base, committed and uncommitted, file
// by file with patches. Read-only: only `git diff`, `git status`, and friends.
import fs from 'node:fs'
import { join } from 'node:path'
import type { DiffCommit, DiffFile, WorkspaceDiff } from '../shared/protocol'
import type { Project, Workspace } from '../shared/types'
import { badRequest } from './errors'
import { git } from './workspaces'

/** A patch longer than this many characters is reported as null. */
export const MAX_PATCH_CHARS = 200_000
const GIT_TIMEOUT_MS = 15_000
/** At most this many commits are listed. */
export const MAX_COMMITS = 200
/** At most this many refs are offered as bases. */
export const MAX_BASES = 50
/** git's empty tree, the parent of a root commit. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export interface NumstatEntry {
  path: string
  from: string | null
  additions: number
  deletions: number
  binary: boolean
}

/** Resolves git's rename display (`a => b` or `pre/{a => b}/post`) to old and new paths. */
export function parseRenamePath(spec: string): { from: string; path: string } {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(spec)
  if (braced) {
    const [, pre = '', a = '', b = '', post = ''] = braced
    const join2 = (mid: string): string => `${pre}${mid}${post}`.replace(/\/\//g, '/')
    return { from: join2(a), path: join2(b) }
  }
  const plain = / => /.exec(spec)
  if (plain) return { from: spec.slice(0, plain.index), path: spec.slice(plain.index + 4) }
  return { from: spec, path: spec }
}

/** Parses `git diff --numstat -M` output. */
export function parseNumstat(out: string): NumstatEntry[] {
  const entries: NumstatEntry[] = []
  for (const line of out.split('\n')) {
    const m = /^(\S+)\t(\S+)\t(.+)$/.exec(line)
    if (!m) continue
    const [, add = '', del = '', spec = ''] = m
    const binary = add === '-' || del === '-'
    const renamed = / => /.test(spec)
    const { from, path } = parseRenamePath(spec)
    entries.push({
      path,
      from: renamed ? from : null,
      additions: binary ? 0 : Number(add),
      deletions: binary ? 0 : Number(del),
      binary
    })
  }
  return entries
}

/** Parses `git diff --name-status -M` output into path → status (and rename source). */
export function parseNameStatus(
  out: string
): Map<string, { status: DiffFile['status']; from: string | null }> {
  const map = new Map<string, { status: DiffFile['status']; from: string | null }>()
  for (const line of out.split('\n')) {
    const parts = line.split('\t')
    const code = parts[0]?.[0]
    if (!code) continue
    if ((code === 'R' || code === 'C') && parts[1] && parts[2]) {
      map.set(parts[2], { status: 'renamed', from: parts[1] })
    } else if (parts[1]) {
      const status = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified'
      map.set(parts[1], { status, from: null })
    }
  }
  return map
}

/** Paths touched according to `git status --porcelain` (new path for renames). */
export function parsePorcelainPaths(out: string): Set<string> {
  const paths = new Set<string>()
  for (const line of out.split('\n')) {
    // git() trims stdout, so the first line may have lost its leading space.
    const rest = /^[ MADRCTU?!]{1,2} (.+)$/.exec(line)?.[1]
    if (!rest) continue
    const arrow = rest.lastIndexOf(' -> ')
    paths.add(arrow >= 0 ? rest.slice(arrow + 4) : rest)
  }
  return paths
}

/** Joins the numstat and name-status listings on the new path. */
export function mergeListings(
  numstat: NumstatEntry[],
  names: Map<string, { status: DiffFile['status']; from: string | null }>,
  dirty: Set<string>
): Omit<DiffFile, 'patch'>[] {
  return numstat.map((n) => {
    const named = names.get(n.path)
    return {
      path: n.path,
      from: named?.from ?? n.from,
      status: named?.status ?? (n.from ? 'renamed' : 'modified'),
      additions: n.additions,
      deletions: n.deletions,
      dirty: dirty.has(n.path)
    }
  })
}

/** Parses `git log --format=%H%x00%s%x00%an%x00%aI` output, newest first as git prints it. */
export function parseLog(out: string): DiffCommit[] {
  const commits: DiffCommit[] = []
  for (const line of out.split('\n')) {
    const [sha = '', subject = '', author = '', at = ''] = line.split('\0')
    if (!/^[0-9a-f]{7,}$/.test(sha)) continue
    commits.push({ sha, shortSha: sha.slice(0, 7), subject, author, at })
  }
  return commits
}

/**
 * Parses `git for-each-ref --format=%(refname)` output into short names:
 * `refs/heads/x` is `x`, `refs/remotes/origin/x` is `origin/x`. The remote's
 * HEAD pointer and anything else are dropped.
 */
export function parseRefs(out: string): string[] {
  const refs: string[] = []
  for (const line of out.split('\n')) {
    if (line.startsWith('refs/heads/')) refs.push(line.slice('refs/heads/'.length))
    else if (line.startsWith('refs/remotes/origin/') && line !== 'refs/remotes/origin/HEAD')
      refs.push(line.slice('refs/remotes/'.length))
  }
  return refs.filter((r) => r !== '')
}

/**
 * The refs worth comparing against: `chosen` first, then the default branch
 * here and on origin when they exist, then the rest in order; no duplicates,
 * at most MAX_BASES.
 */
export function orderBases(chosen: string, def: string, refs: string[]): string[] {
  const known = new Set(refs)
  const ordered = [chosen]
  for (const r of [def, `origin/${def}`]) if (known.has(r)) ordered.push(r)
  ordered.push(...refs)
  return [...new Set(ordered)].slice(0, MAX_BASES)
}

/** The patch, or null when it is too long. */
export function capPatch(patch: string): string | null {
  return patch.length > MAX_PATCH_CHARS ? null : patch
}

function countLines(text: string): number {
  if (text.length === 0) return 0
  const newlines = text.split('\n').length - 1
  return text.endsWith('\n') ? newlines : newlines + 1
}

async function chooseBase(ws: Workspace, project: Project): Promise<string> {
  const def = project.defaultBranch
  const q = (ref: string): Promise<{ ok: boolean }> =>
    git(ws.path, ['show-ref', '--verify', '--quiet', ref], GIT_TIMEOUT_MS)
  if ((await q(`refs/remotes/origin/${def}`)).ok) return `origin/${def}`
  if ((await q(`refs/heads/${def}`)).ok) return def
  return ws.baseRef
}

export interface DiffOptions {
  /** Compare against this ref instead of the default base. */
  base?: string
  /** Narrow the files to this commit's own changes. */
  commit?: string
}

type Run = (...args: string[]) => ReturnType<typeof git>

export async function workspaceDiff(
  ws: Workspace,
  project: Project,
  now: () => number,
  opts: DiffOptions = {}
): Promise<WorkspaceDiff> {
  const run: Run = (...args) => git(ws.path, ['-c', 'core.quotepath=off', ...args], GIT_TIMEOUT_MS)
  const empty = (base: string): WorkspaceDiff => ({
    workspaceId: ws.id,
    base,
    head: ws.branch,
    commitsAhead: 0,
    commits: [],
    bases: [base],
    commit: null,
    files: [],
    generatedAt: new Date(now()).toISOString()
  })
  if (!fs.existsSync(ws.path)) return empty(ws.baseRef)

  // An asked-for base or commit is checked first, so a bad one is an error
  // rather than an empty diff.
  const resolveCommit = async (ref: string): Promise<string | null> => {
    if (ref.startsWith('-')) return null
    const r = await run('rev-parse', '--verify', '--quiet', `${ref}^{commit}`)
    return r.ok && r.stdout ? r.stdout : null
  }
  if (opts.base !== undefined && !(await resolveCommit(opts.base))) {
    throw badRequest(`base ${opts.base} is not a commit`)
  }
  const base = opts.base ?? (await chooseBase(ws, project))
  let commit: string | null = null
  if (opts.commit !== undefined) {
    const sha = await resolveCommit(opts.commit)
    const onBranch =
      sha !== null &&
      (await run('merge-base', '--is-ancestor', sha, 'HEAD')).ok &&
      !(await run('merge-base', '--is-ancestor', sha, base)).ok
    if (!sha || !onBranch) {
      throw badRequest(`commit ${opts.commit} is not on this branch past ${base}`)
    }
    commit = sha
  }

  try {
    const [counted, log, refs] = await Promise.all([
      run('rev-list', '--count', `${base}..HEAD`),
      run('log', '--format=%H%x00%s%x00%an%x00%aI', '-n', String(MAX_COMMITS), `${base}..HEAD`),
      run('for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin')
    ])
    // Never the workspace's own branch: comparing it against itself shows nothing.
    const refNames = parseRefs(refs.stdout).filter((r) => r !== ws.branch)
    const result = (files: DiffFile[]): WorkspaceDiff => ({
      ...empty(base),
      commitsAhead:
        counted.ok && Number.isInteger(Number(counted.stdout)) ? Number(counted.stdout) : 0,
      commits: log.ok ? parseLog(log.stdout) : [],
      bases: orderBases(base, project.defaultBranch, refNames),
      commit,
      files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    })

    if (commit) {
      // That commit's own changes; a root commit is compared with the empty tree.
      const hasParent = (await run('rev-parse', '--verify', '--quiet', `${commit}^`)).ok
      return result(await listFiles(run, [hasParent ? `${commit}^` : EMPTY_TREE, commit]))
    }

    const mb = await run('merge-base', base, 'HEAD')
    const mergeBase = mb.ok && mb.stdout ? mb.stdout : base
    const [status, others] = await Promise.all([
      run('status', '--porcelain'),
      run('ls-files', '--others', '--exclude-standard')
    ])
    const files = await listFiles(run, [mergeBase], parsePorcelainPaths(status.stdout))

    const seen = new Set(files.map((f) => f.path))
    const untracked = others.stdout.split('\n').filter((p) => p && !seen.has(p))
    const extra = await Promise.all(
      untracked.map(async (path): Promise<DiffFile> => {
        let text: string | null = null
        try {
          const buf = await fs.promises.readFile(join(ws.path, path))
          text = buf.includes(0) ? null : buf.toString('utf8')
        } catch {
          text = null
        }
        const file: DiffFile = {
          path,
          from: null,
          status: 'untracked',
          additions: text === null ? 0 : countLines(text),
          deletions: 0,
          dirty: true,
          patch: null
        }
        if (text === null) return file
        const p = await run('diff', '--no-index', '--', '/dev/null', path)
        return { ...file, patch: capPatch(p.stdout) }
      })
    )
    return result([...files, ...extra])
  } catch {
    return empty(ws.baseRef)
  }
}

/**
 * The tracked files changed across `range` (one rev: it against the working
 * tree; two: the first against the second), each with its patch.
 */
async function listFiles(
  run: Run,
  range: string[],
  dirty = new Set<string>()
): Promise<DiffFile[]> {
  const [numstat, names] = await Promise.all([
    run('diff', '--numstat', '-M', ...range),
    run('diff', '--name-status', '-M', ...range)
  ])
  const entries = parseNumstat(numstat.stdout)
  const binary = new Set(entries.filter((e) => e.binary).map((e) => e.path))
  const listed = mergeListings(entries, parseNameStatus(names.stdout), dirty)
  return Promise.all(
    listed.map(async (f): Promise<DiffFile> => {
      if (binary.has(f.path)) return { ...f, patch: null }
      const args = f.from
        ? ['diff', '-M', ...range, '--', f.from, f.path]
        : ['diff', ...range, '--', f.path]
      const p = await run(...args)
      return { ...f, patch: p.ok ? capPatch(p.stdout) : null }
    })
  )
}
