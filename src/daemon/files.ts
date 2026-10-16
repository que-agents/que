// Every file of a worktree (tracked and untracked, never ignored), and one
// file's content for the file view. Read-only: `git ls-files` and plain reads,
// never outside the worktree, symlinks included.
import fs from 'node:fs'
import { isAbsolute, join, sep } from 'node:path'
import type { WorkspaceFile, WorkspaceFiles } from '../shared/protocol'
import type { Workspace } from '../shared/types'
import { badRequest, notFound } from './errors'
import { git } from './workspaces'

/** At most this many paths are listed. */
export const MAX_FILES = 20_000

/** A file's content is cut at this many characters. */
export const MAX_FILE_CHARS = 500_000

/** A NUL byte within this many leading bytes marks a file binary. */
const BINARY_SNIFF_BYTES = 8192
const GIT_TIMEOUT_MS = 15_000

/** Parses `git ls-files -z` output: deduplicated, sorted, cut at MAX_FILES. */
export function parseLsFiles(stdout: string): { files: string[]; truncated: boolean } {
  const unique = [...new Set(stdout.split('\0').filter((p) => p !== ''))]
  unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const truncated = unique.length > MAX_FILES

  return { files: truncated ? unique.slice(0, MAX_FILES) : unique, truncated }
}

/**
 * The normalized relative path when `path` names something strictly inside
 * the worktree (`./a` is `a`, a trailing slash is dropped); null for the root
 * itself, an absolute path, or any empty, `.` or `..` segment. No filesystem.
 */
export function insideWorktree(_root: string, path: string): string | null {
  if (path === '' || isAbsolute(path)) return null
  let rest = path

  while (rest.startsWith('./')) rest = rest.slice(2)

  if (rest.endsWith('/')) rest = rest.slice(0, -1)

  if (rest === '') return null
  const segments = rest.split('/')

  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null

  return rest
}

/** Every tracked and untracked, non-ignored file of the worktree. */
export async function workspaceFiles(ws: Workspace, now: () => number): Promise<WorkspaceFiles> {
  const generatedAt = new Date(now()).toISOString()

  if (!fs.existsSync(ws.path)) {
    return { workspaceId: ws.id, files: [], truncated: false, generatedAt }
  }

  const r = await git(
    ws.path,
    ['-c', 'core.quotepath=off', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    GIT_TIMEOUT_MS
  )

  if (!r.ok) throw badRequest(r.stderr.split('\n')[0] || 'git ls-files failed')

  return { workspaceId: ws.id, ...parseLsFiles(r.stdout), generatedAt }
}

const isMissing = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException).code

  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** One file of the worktree: its text (capped), or null content when binary. */
export async function readWorkspaceFile(ws: Workspace, path: string): Promise<WorkspaceFile> {
  const rel = insideWorktree(ws.path, path)

  if (rel === null) throw badRequest(`not a path inside the worktree: ${path}`)
  let real: string
  let stat: fs.Stats

  try {
    const root = await fs.promises.realpath(ws.path)
    real = await fs.promises.realpath(join(ws.path, rel))

    if (!real.startsWith(root + sep)) throw badRequest(`outside the worktree: ${rel}`)
    stat = await fs.promises.stat(real)
  } catch (err) {
    if (isMissing(err)) throw notFound(`no such file: ${rel}`)
    throw err
  }

  if (!stat.isFile()) throw badRequest(`not a file: ${rel}`)
  const bytes = await fs.promises.readFile(real)
  const base = { workspaceId: ws.id, path: rel, size: stat.size }

  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    return { ...base, content: null, binary: true, truncated: false }
  }

  const text = bytes.toString('utf8')
  const truncated = text.length > MAX_FILE_CHARS

  return {
    ...base,
    content: truncated ? text.slice(0, MAX_FILE_CHARS) : text,
    binary: false,
    truncated
  }
}
