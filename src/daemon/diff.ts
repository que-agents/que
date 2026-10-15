// What a workspace changed against its base, committed and uncommitted, file
// by file with patches. Read-only: only `git diff`, `git status`, and friends.
import fs from 'node:fs'
import { join } from 'node:path'
import type { DiffFile, WorkspaceDiff } from '../shared/protocol'
import type { Project, Workspace } from '../shared/types'
import { git } from './workspaces'

/** A patch longer than this many characters is reported as null. */
export const MAX_PATCH_CHARS = 200_000
const GIT_TIMEOUT_MS = 15_000

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

export async function workspaceDiff(
  ws: Workspace,
  project: Project,
  now: () => number
): Promise<WorkspaceDiff> {
  const run = (...args: string[]): ReturnType<typeof git> =>
    git(ws.path, ['-c', 'core.quotepath=off', ...args], GIT_TIMEOUT_MS)
  const result = (base: string, commits: number, files: DiffFile[]): WorkspaceDiff => ({
    workspaceId: ws.id,
    base,
    head: ws.branch,
    commitsAhead: commits,
    files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    generatedAt: new Date(now()).toISOString()
  })
  try {
    if (!fs.existsSync(ws.path)) return result(ws.baseRef, 0, [])
    const base = await chooseBase(ws, project)
    const counted = await run('rev-list', '--count', `${base}..HEAD`)
    const commits =
      counted.ok && Number.isInteger(Number(counted.stdout)) ? Number(counted.stdout) : 0
    const mb = await run('merge-base', base, 'HEAD')
    const mergeBase = mb.ok && mb.stdout ? mb.stdout : base

    const [numstat, names, status, others] = await Promise.all([
      run('diff', '--numstat', '-M', mergeBase),
      run('diff', '--name-status', '-M', mergeBase),
      run('status', '--porcelain'),
      run('ls-files', '--others', '--exclude-standard')
    ])
    const dirty = parsePorcelainPaths(status.stdout)
    const entries = parseNumstat(numstat.stdout)
    const binary = new Set(entries.filter((e) => e.binary).map((e) => e.path))
    const listed = mergeListings(entries, parseNameStatus(names.stdout), dirty)

    const files: DiffFile[] = await Promise.all(
      listed.map(async (f) => {
        if (binary.has(f.path)) return { ...f, patch: null }
        const args = f.from
          ? ['diff', '-M', mergeBase, '--', f.from, f.path]
          : ['diff', mergeBase, '--', f.path]
        const p = await run(...args)
        return { ...f, patch: p.ok ? capPatch(p.stdout) : null }
      })
    )

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
        const base: DiffFile = {
          path,
          from: null,
          status: 'untracked',
          additions: text === null ? 0 : countLines(text),
          deletions: 0,
          dirty: true,
          patch: null
        }
        if (text === null) return base
        const p = await run('diff', '--no-index', '--', '/dev/null', path)
        return { ...base, patch: capPatch(p.stdout) }
      })
    )
    return result(base, commits, [...files, ...extra])
  } catch {
    return result(ws.baseRef, 0, [])
  }
}
