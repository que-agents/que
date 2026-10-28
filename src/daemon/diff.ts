// The git side of a workspace's diff: resolving what a diff compares (scopes
// and ranges) and parsing what `git diff`, `git log` and friends print. Used by
// workspace.diff (workspace-diff.ts), workspace.diffFile, and the comment split.
import type { DiffCommit, DiffFile } from '../shared/protocol'
import type { Project, Workspace } from '../shared/types'
import type { ListedFile } from './comment-lines'
import { badRequest } from './errors'
import { git, type GitOptions } from './workspaces'

/** A patch longer than this many characters is reported as null. */
export const MAX_PATCH_CHARS = 200_000
export const GIT_TIMEOUT_MS = 15_000

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
export function parseRenamePath(spec: string) {
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
): Omit<ListedFile, 'patch'>[] {
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

/** `origin/<default>` when it exists, else the local default branch, else the workspace's base. */
function chooseBase(ws: Workspace, project: Project, refs: readonly string[]): string {
  const def = project.defaultBranch

  if (refs.includes(`origin/${def}`)) return `origin/${def}`

  if (refs.includes(def)) return def

  return ws.baseRef
}

/**
 * Splits `git diff` output into one patch per file, in git's order, each
 * trimmed as git() trims a single file's diff.
 */
export function splitPatches(out: string): string[] {
  if (!out.startsWith('diff --git ')) return []

  return out.split(/\n(?=diff --git )/).map((p) => p.trim())
}

export interface DiffOptions {
  /** Compare against this ref instead of the default base. */
  base?: string
  /**
   * Compare this branch instead of the worktree: `merge-base(base, head)..head`, with no working
   * tree and no untracked files. `head` resolves here first, then as `origin/<ref>`; `base` the
   * other way round.
   */
  head?: string
  /** Narrow the files to this commit's own changes. */
  commit?: string
}

export type Run = (...args: string[]) => ReturnType<typeof git>

/** git in the worktree, paths printed as they are (no octal quoting), with diff's timeout. */
export function gitRunner(ws: Workspace, opts: GitOptions = {}): Run {
  return (...args) => git(ws.path, ['-c', 'core.quotepath=off', ...args], GIT_TIMEOUT_MS, opts)
}

/** One file of `git diff --raw --no-abbrev -M`: its blob ids (null for none or not hashed yet). */
export interface RawEntry {
  path: string
  from: string | null
  status: DiffFile['status']
  oldId: string | null
  newId: string | null
}

const ZERO_ID = /^0+$/

/**
 * Parses `git diff --raw --no-abbrev -M` output, keyed by new path. An id of
 * all zeros (no such side, or a working-tree file git has not hashed) is null.
 */
export function parseRawDiff(out: string): Map<string, RawEntry> {
  const map = new Map<string, RawEntry>()

  for (const line of out.split('\n')) {
    const m = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*\t([^\t]+)(?:\t(.+))?$/.exec(line)

    if (!m) continue
    const [, oldSha = '', newSha = '', code = '', first = '', second] = m
    const renamed = (code === 'R' || code === 'C') && second !== undefined
    const path = renamed ? second : first

    map.set(path, {
      path,
      from: renamed ? first : null,
      status: renamed ? 'renamed' : code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified',
      oldId: ZERO_ID.test(oldSha) ? null : oldSha,
      newId: ZERO_ID.test(newSha) ? null : newSha
    })
  }

  return map
}

/** Parses `git cat-file --batch-check` output into object id → size; missing objects are left out. */
export function parseBatchCheck(out: string): Map<string, number> {
  const sizes = new Map<string, number>()

  for (const line of out.split('\n')) {
    const m = /^([0-9a-f]+) \S+ (\d+)$/.exec(line.trim())

    if (m?.[1] && m[2]) sizes.set(m[1], Number(m[2]))
  }

  return sizes
}

/** What a diff compares, resolved from the caller's options. */
export interface DiffScope {
  /** The ref compared against. */
  base: string
  /** The asked-for base when it was not a commit (`base` is then the default); else null. */
  rejectedBase: string | null
  /** What is compared: `HEAD` (with the working tree), or the resolved `head` ref. */
  tip: string
  /** The commit narrowed to, as a full sha, or null. */
  commit: string | null
  /** The short names of the local and origin branches. */
  refs: string[]
}

/**
 * Resolves the options to a scope. A head or commit that is not on this
 * branch is a bad request; a base that is not a commit falls back to the
 * default and is reported as rejected.
 */
export async function resolveScope(
  run: Run,
  ws: Workspace,
  project: Project,
  opts: DiffOptions
): Promise<DiffScope> {
  // An asked-for commit is checked, so a bad one is an error rather than an empty diff.
  const resolveCommit = async (ref: string): Promise<string | null> => {
    if (ref.startsWith('-')) return null
    const r = await run('rev-parse', '--verify', '--quiet', `${ref}^{commit}`)

    return r.ok && r.stdout ? r.stdout : null
  }

  // A pull request's head may be a branch only origin has: the ref here first (it holds the
  // session's unpushed work), else origin's. Its base is origin's first, since a local default
  // branch is often behind.
  const resolveRef = async (ref: string, originFirst = false): Promise<string | null> => {
    const names = originFirst ? [`origin/${ref}`, ref] : [ref, `origin/${ref}`]
    const found = await Promise.all(names.map((name) => resolveCommit(name)))

    return names.find((_, i) => found[i] !== null) ?? null
  }

  // A remembered base can outlive its branch, so one that is not a commit falls back to the
  // default comparison and is reported, letting the caller forget it.
  // Against another branch, the base is a branch name too (that pull request's base).
  const resolveBase = async (base: string): Promise<string | null> => {
    if (opts.head !== undefined) return resolveRef(base, true)

    return (await resolveCommit(base)) === null ? null : base
  }

  const [tip, requested, listed] = await Promise.all([
    opts.head === undefined ? 'HEAD' : resolveRef(opts.head),
    opts.base === undefined ? null : resolveBase(opts.base),
    run('for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin')
  ])

  if (tip === null) throw badRequest(`head ${opts.head} is not a branch here or on origin`)
  const refs = parseRefs(listed.stdout)

  const base = requested ?? chooseBase(ws, project, refs)
  const rejectedBase = requested === null && opts.base !== undefined ? opts.base : null
  let commit: string | null = null

  if (opts.commit !== undefined) {
    const sha = await resolveCommit(opts.commit)

    const onBranch =
      sha !== null &&
      (await run('merge-base', '--is-ancestor', sha, tip)).ok &&
      !(await run('merge-base', '--is-ancestor', sha, base)).ok

    if (!sha || !onBranch) {
      throw badRequest(`commit ${opts.commit} is not on this branch past ${base}`)
    }

    commit = sha
  }

  return { base, rejectedBase, tip, commit, refs }
}

/**
 * The two sides a scope's files are compared between: a commit's parent (the
 * empty tree for a root commit) and the commit; else the merge base and the
 * head, where a null `to` is the working tree.
 */
export async function scopeRange(
  run: Run,
  scope: DiffScope,
  opts: DiffOptions
): Promise<DiffRange> {
  if (scope.commit) {
    const hasParent = (await run('rev-parse', '--verify', '--quiet', `${scope.commit}^`)).ok

    return { from: hasParent ? `${scope.commit}^` : EMPTY_TREE, to: scope.commit }
  }

  const mb = await run('merge-base', scope.base, scope.tip)
  const mergeBase = mb.ok && mb.stdout ? mb.stdout : scope.base

  // Another branch's own changes: committed only, the worktree has nothing to do with it.
  return { from: mergeBase, to: opts.head === undefined ? null : scope.tip }
}

/** The two sides a scope compares (see scopeRange). */
export interface DiffRange {
  from: string
  /** null: the working tree. */
  to: string | null
}
