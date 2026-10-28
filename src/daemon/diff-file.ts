// One file's diff as hunks of tokenized lines (workspace.diffFile), in the same
// scopes as workspace.diff. Both sides are read whole and tokenized whole, so
// a line's colours come from the file, not from the patch fragment; the diff
// itself carries the whole file as context when it is small enough.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { join } from 'node:path'
import type {
  DiffFile,
  DiffHunk,
  DiffLine,
  DiffToken,
  WorkspaceDiffFile,
  WorkspaceDiffFileParams
} from '../shared/protocol'
import type { Project, Workspace } from '../shared/types'
import { run as exec } from '../shared/exec'
import {
  type DiffOptions,
  GIT_TIMEOUT_MS,
  gitRunner,
  parseNameStatus,
  parseNumstat,
  resolveScope,
  scopeRange
} from './diff'
import { isBinaryPatch, parseHunks, type RawLine, splitLines } from './diff-parse'
import { badRequest, notFound } from './errors'
import { insideWorktree } from './files'
import { languageFor } from './syntax'
import type { Tokenizer } from './tokenizer'
import { markChangeBlocks } from './word-marks'

/** Both sides at most this many lines (and FULL_CONTEXT_CHARS) get whole-file context. */
export const FULL_CONTEXT_LINES = 5_000
export const FULL_CONTEXT_CHARS = 400_000

/** Either side larger than this many bytes is not diffed at all. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024

/** Results kept for unchanged files. */
const CACHE_ENTRIES = 200

/** The file-level part of a result: everything but the scope it was asked in. */
type FileDiff = Pick<
  WorkspaceDiffFile,
  | 'path'
  | 'from'
  | 'status'
  | 'whitespace'
  | 'fullContext'
  | 'language'
  | 'skipped'
  | 'additions'
  | 'deletions'
  | 'hunks'
>

/** A small least-recently-used map. */
export class Lru<V> {
  private readonly map = new Map<string, V>()

  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key)

    if (v === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, v)

    return v
  }

  set(key: string, v: V): void {
    this.map.delete(key)
    this.map.set(key, v)

    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next()

      if (oldest.done) break
      this.map.delete(oldest.value)
    }
  }
}

const cache = new Lru<FileDiff>(CACHE_ENTRIES)

/** git without trimming its output: file contents and diffs keep their edge whitespace. */
async function gitRaw(ws: Workspace, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  const r = await exec('git', ['-c', 'core.quotepath=off', ...args], {
    cwd: ws.path,
    timeoutMs: GIT_TIMEOUT_MS,
    maxBuffer: 4 * MAX_FILE_BYTES,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })

  return { ok: r.ok, stdout: r.stdout }
}

/** Whole-file context fits when both sides are small. */
export function fitsFullContext(before: string, after: string): boolean {
  return [before, after].every(
    (t) => t.length <= FULL_CONTEXT_CHARS && splitLines(t).length <= FULL_CONTEXT_LINES
  )
}

/** Lays each raw line's tokens on from the tokenized sides; a line they disagree with is plain. */
export function tokenizeHunkLines(
  lines: readonly RawLine[],
  before: readonly DiffToken[][],
  after: readonly DiffToken[][]
): DiffLine[] {
  const fits = (tokens: readonly DiffToken[] | undefined, text: string): boolean =>
    tokens !== undefined && tokens.map((t) => t.text).join('') === text

  return lines.map((l) => {
    const fromNew = l.new === null ? undefined : after[l.new - 1]
    const fromOld = l.old === null ? undefined : before[l.old - 1]
    // A context line under -w may differ in whitespace from one side: whichever matches.
    const preferred = l.kind === 'removed' ? [fromOld] : [fromNew, fromOld]
    const tokens = preferred.find((t) => fits(t, l.text))

    return {
      kind: l.kind,
      old: l.old,
      new: l.new,
      tokens: tokens
        ? tokens.map((t) => ({ ...t }))
        : l.text === ''
          ? []
          : [{ text: l.text, kind: 'plain' as const }]
    }
  })
}

/** The structured hunks of a patch, tokens laid on and word marks set. */
export function buildHunks(
  patch: string,
  before: readonly DiffToken[][],
  after: readonly DiffToken[][]
): DiffHunk[] {
  return parseHunks(patch).map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    label: h.label,
    lines: markChangeBlocks(tokenizeHunkLines(h.lines, before, after))
  }))
}

interface Side {
  /** A git blob id, or a content hash for a worktree file; null when the side is absent. */
  id: string | null
  size: number
  /** Reads the content; only called once the size is known to be under the cap. */
  read: () => Promise<string>
}

const ABSENT: Side = { id: null, size: 0, read: async () => '' }

async function blobSide(ws: Workspace, rev: string, path: string): Promise<Side> {
  const run = gitRunner(ws)
  const id = await run('rev-parse', '--verify', '--quiet', `${rev}:${path}`)

  if (!id.ok || !id.stdout) return ABSENT
  const size = await run('cat-file', '-s', id.stdout)

  return {
    id: id.stdout,
    size: Number(size.stdout) || 0,
    read: async () => (await gitRaw(ws, ['cat-file', 'blob', id.stdout])).stdout
  }
}

async function worktreeSide(ws: Workspace, path: string): Promise<Side> {
  const file = join(ws.path, path)
  let size: number

  try {
    const stat = await fs.promises.stat(file)

    if (!stat.isFile()) return ABSENT
    size = stat.size
  } catch {
    return ABSENT
  }

  if (size > MAX_FILE_BYTES) return { id: null, size, read: async () => '' }
  const buf = await fs.promises.readFile(file)
  const text = buf.toString('utf8')

  return {
    id: `worktree:${createHash('sha1').update(buf).digest('hex')}`,
    size: buf.length,
    read: async () => text
  }
}

/** One file's diff in a workspace.diff scope; see WorkspaceDiffFile. */
export async function workspaceDiffFile(
  ws: Workspace,
  project: Project,
  params: Omit<WorkspaceDiffFileParams, 'id'>,
  tokenizer: Tokenizer
): Promise<WorkspaceDiffFile> {
  const path = insideWorktree(ws.path, params.path)

  if (path === null) throw badRequest(`not a path inside the worktree: ${params.path}`)

  if (!fs.existsSync(ws.path)) throw notFound(`the worktree is gone: ${ws.path}`)
  const whitespace = params.whitespace ?? 'show'
  const opts: DiffOptions = { base: params.base, head: params.head, commit: params.commit }
  const run = gitRunner(ws)
  const scope = await resolveScope(run, ws, project, opts)
  const range = await scopeRange(run, scope, opts)
  const revs = range.to === null ? [range.from] : [range.from, range.to]

  const names = parseNameStatus((await run('diff', '--name-status', '-M', ...revs)).stdout)
  let entry: { status: DiffFile['status']; from: string | null } | undefined = names.get(path)

  if (!entry && range.to === null) {
    const others = await run('ls-files', '--others', '--exclude-standard', '--', path)

    if (others.stdout.split('\n').includes(path)) entry = { status: 'untracked', from: null }
  }

  if (!entry) throw notFound(`${path} has no changes in this diff`)
  const { status, from } = entry
  const oldPath = from ?? path
  const isNew = status === 'added' || status === 'untracked'

  const [before, after] = await Promise.all([
    isNew ? ABSENT : blobSide(ws, range.from, oldPath),
    status === 'deleted'
      ? ABSENT
      : range.to === null
        ? worktreeSide(ws, path)
        : blobSide(ws, range.to, path)
  ])

  const flags = whitespace === 'ignore' ? ['-w'] : []

  const diffArgs = (extra: string[]): string[] =>
    status === 'untracked'
      ? [
          'diff',
          '--no-index',
          '--no-color',
          '--no-ext-diff',
          ...flags,
          ...extra,
          '--',
          '/dev/null',
          path
        ]
      : [
          'diff',
          '--no-color',
          '--no-ext-diff',
          '-M',
          ...flags,
          ...extra,
          ...revs,
          '--',
          ...(from ? [from] : []),
          path
        ]

  const scoped = (file: FileDiff): WorkspaceDiffFile => ({
    workspaceId: ws.id,
    base: scope.base,
    head: params.head ?? ws.branch,
    commit: scope.commit,
    ...structuredClone(file)
  })

  const skippedResult = async (skipped: 'binary' | 'too-large'): Promise<WorkspaceDiffFile> => {
    const counted = parseNumstat((await gitRaw(ws, diffArgs(['--numstat']))).stdout)[0]

    return scoped({
      path,
      from,
      status,
      whitespace,
      fullContext: false,
      language: null,
      skipped,
      additions: skipped === 'binary' ? 0 : (counted?.additions ?? 0),
      deletions: skipped === 'binary' ? 0 : (counted?.deletions ?? 0),
      hunks: []
    })
  }

  if (before.size > MAX_FILE_BYTES || after.size > MAX_FILE_BYTES) {
    return skippedResult('too-large')
  }

  const key = JSON.stringify([before.id, after.id, path, from, whitespace])
  const hit = cache.get(key)

  if (hit) return scoped(hit)

  const [oldText, newText] = await Promise.all([before.read(), after.read()])

  if (oldText.includes('\0') || newText.includes('\0')) return skippedResult('binary')
  const fullContext = fitsFullContext(oldText, newText)

  const context = fullContext
    ? [`-U${Math.max(splitLines(oldText).length, splitLines(newText).length, 1)}`]
    : []

  const patch = (await gitRaw(ws, diffArgs(context))).stdout

  if (isBinaryPatch(patch)) return skippedResult('binary')
  const language = languageFor(path)

  const [oldTokens, newTokens] = await Promise.all([
    tokenizer.tokenizeFile(oldText, language),
    tokenizer.tokenizeFile(newText, language)
  ])

  const hunks = buildHunks(patch, oldTokens.lines, newTokens.lines)
  const lines = hunks.flatMap((h) => h.lines)

  const file: FileDiff = {
    path,
    from,
    status,
    whitespace,
    fullContext,
    language: newTokens.language ?? oldTokens.language,
    skipped: null,
    additions: lines.filter((l) => l.kind === 'added').length,
    deletions: lines.filter((l) => l.kind === 'removed').length,
    hunks
  }

  // A result coloured plain because the tokenizer failed is not kept: the next ask tries again.
  if (!oldTokens.degraded && !newTokens.degraded) cache.set(key, file)

  return scoped(file)
}
