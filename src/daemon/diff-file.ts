// One file's diff as hunks of tokenized lines (workspace.diffFile), in the same
// scopes as workspace.diff. Both sides are read whole and tokenized whole, so
// a line's colours come from the file, not from the patch fragment; the diff
// itself carries the whole file as context when it is small enough. The same
// tokenizing splits workspace.diff's files into code and comment changes
// (classifyComments), cached by the same blob ids.
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
  countCommentLines,
  type CommentSplit,
  type ListedFile,
  markCommentLines,
  withSplit
} from './comment-lines'
import {
  type DiffOptions,
  type DiffRange,
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
import type { TokenizeResult, Tokenizer } from './tokenizer'
import { markChangeBlocks } from './word-marks'

/** Both sides at most this many lines (and FULL_CONTEXT_CHARS) get whole-file context. */
export const FULL_CONTEXT_LINES = 5_000
export const FULL_CONTEXT_CHARS = 400_000

/** Either side larger than this many bytes is not diffed at all. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024

/** Results kept for unchanged files. */
const CACHE_ENTRIES = 200

/** A diff listing more files than this is not split into code and comments at all. */
export const MAX_CLASSIFIED_FILES = 300

/** Files tokenized for the split at once; the worker is single, so more would only queue. */
const CLASSIFY_CONCURRENCY = 4

/**
 * How long workspace.diff waits for the split. Files still being classified then count as code
 * in that answer and finish in the background; the next answer has them from the cache.
 */
export const CLASSIFY_BUDGET_MS = 300

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

/** Comment splits by both sides' ids and the paths; 'skip' for a file too large to classify. */
const splits = new Lru<CommentSplit | 'skip'>(2_000)

const splitKey = (
  beforeId: string | null,
  afterId: string | null,
  path: string,
  from: string | null
): string => JSON.stringify([beforeId, afterId, path, from])

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

/** The structured hunks of a patch, tokens laid on, comment lines and (unless off) word marks set. */
export function buildHunks(
  patch: string,
  before: readonly DiffToken[][],
  after: readonly DiffToken[][],
  wordMarks = true
): DiffHunk[] {
  return parseHunks(patch).map((h) => {
    const lines = tokenizeHunkLines(h.lines, before, after)

    return {
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      label: h.label,
      lines: markCommentLines(wordMarks ? markChangeBlocks(lines) : lines)
    }
  })
}

/** Both sides tokenized whole in the path's language; degraded when either fell back to plain. */
async function tokenizeSides(
  path: string,
  oldText: string,
  newText: string,
  tokenizer: Tokenizer
): Promise<{ before: TokenizeResult; after: TokenizeResult; degraded: boolean }> {
  const language = languageFor(path)

  const [before, after] = await Promise.all([
    tokenizer.tokenizeFile(oldText, language),
    tokenizer.tokenizeFile(newText, language)
  ])

  return { before, after, degraded: before.degraded || after.degraded }
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
  const id = await gitRunner(ws)('rev-parse', '--verify', '--quiet', `${rev}:${path}`)

  return id.ok && id.stdout ? blobById(ws, id.stdout) : ABSENT
}

async function blobById(ws: Workspace, id: string): Promise<Side> {
  const size = await gitRunner(ws)('cat-file', '-s', id)

  return {
    id,
    size: Number(size.stdout) || 0,
    read: async () => (await gitRaw(ws, ['cat-file', 'blob', id])).stdout
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
  const sides = await tokenizeSides(path, oldText, newText, tokenizer)
  const { before: oldTokens, after: newTokens } = sides
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
  if (!sides.degraded) {
    cache.set(key, file)

    // Its changed lines are the file list's too, so its split serves workspace.diff as well.
    if (whitespace === 'show')
      splits.set(splitKey(before.id, after.id, path, from), countCommentLines(lines))
  }

  return scoped(file)
}

/** Runs at most `n` of the given tasks at once, in the order they ask. */
function limiter(n: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: (() => void)[] = []

  return async (task) => {
    // A finishing task hands its slot straight to the next waiter.
    if (active < n) active += 1
    else await new Promise<void>((resolve) => waiting.push(resolve))

    try {
      return await task()
    } finally {
      const next = waiting.shift()

      if (next) next()
      else active -= 1
    }
  }
}

const limit = limiter(CLASSIFY_CONCURRENCY)

/** Working-tree files read for their ids at once, well under the open-file limit. */
const limitReads = limiter(16)

/** Splits being worked out, by key, so overlapping workspace.diff calls share one. */
const inflight = new Map<string, Promise<CommentSplit | null>>()

interface BlobIds {
  before: string | null
  after: string | null
}

/** Each changed file's old and new blob ids across `range` (`git diff --raw`); null when absent. */
async function blobIds(ws: Workspace, range: DiffRange): Promise<Map<string, BlobIds>> {
  const revs = range.to === null ? [range.from] : [range.from, range.to]
  const out = await gitRunner(ws)('diff', '--raw', '-z', '-M', '--no-abbrev', ...revs)
  const ids = new Map<string, BlobIds>()
  const fields = out.stdout.split('\0')
  const named = (id: string | undefined): string | null => (!id || /^0+$/.test(id) ? null : id)

  // Each entry is `:<modes> <old id> <new id> <status>`, then its path, or both paths for a rename.
  for (let i = 0; i < fields.length;) {
    const meta = fields[i]?.split(' ') ?? []
    const renamed = /^[RC]/.test(meta[4] ?? '')
    const path = fields[i + (renamed ? 2 : 1)]

    if (path !== undefined && meta.length >= 5) {
      ids.set(path, { before: named(meta[2]), after: named(meta[3]) })
    }

    i += renamed ? 3 : 2
  }

  return ids
}

/** How many of one listed file's changed lines are comments; null when it cannot be classified. */
async function splitOf(
  ws: Workspace,
  range: DiffRange,
  file: ListedFile & { patch: string },
  ids: BlobIds | undefined,
  tokenizer: Tokenizer
): Promise<CommentSplit | null> {
  const isNew = file.status === 'added' || file.status === 'untracked'
  const isGone = file.status === 'deleted'

  // The working tree's side is known by its content, as workspace.diffFile knows it.
  const worktree =
    range.to === null && !isGone ? await limitReads(() => worktreeSide(ws, file.path)) : null

  if (worktree && worktree.size > FULL_CONTEXT_CHARS) return null
  const beforeId = isNew ? null : (ids?.before ?? null)
  const afterId = worktree ? worktree.id : isGone ? null : (ids?.after ?? null)

  // A side git could not name is not guessed at.
  if ((!isNew && beforeId === null) || (!isGone && afterId === null)) return null
  const key = splitKey(beforeId, afterId, file.path, file.from)
  const hit = splits.get(key)

  if (hit !== undefined) return hit === 'skip' ? null : hit
  const running = inflight.get(key)

  if (running) return running

  const work = limit(async (): Promise<CommentSplit | null> => {
    const [before, after] = await Promise.all([
      beforeId === null ? ABSENT : blobById(ws, beforeId),
      worktree ?? (afterId === null ? ABSENT : blobById(ws, afterId))
    ])

    if (before.size > FULL_CONTEXT_CHARS || after.size > FULL_CONTEXT_CHARS) {
      splits.set(key, 'skip')

      return null
    }

    const [oldText, newText] = await Promise.all([before.read(), after.read()])

    if (oldText.includes('\0') || newText.includes('\0') || !fitsFullContext(oldText, newText)) {
      splits.set(key, 'skip')

      return null
    }

    const sides = await tokenizeSides(file.path, oldText, newText, tokenizer)

    // A file the tokenizer failed on counts as code now and is tried again next time.
    if (sides.degraded) return null

    // The list's own patch (git's default context, whitespace shown) gives the changed lines.
    const hunks = buildHunks(file.patch, sides.before.lines, sides.after.lines, false)
    const split = countCommentLines(hunks.flatMap((h) => h.lines))
    splits.set(key, split)

    return split
  })
    .catch(() => null)
    .finally(() => inflight.delete(key))

  inflight.set(key, work)

  return work
}

export interface ClassifyOptions {
  /** Default CLASSIFY_BUDGET_MS. */
  budgetMs?: number
  /** Called once, after the answer, when splits it went without have since landed in the cache. */
  onLate?: () => void
}

/**
 * workspace.diff's files with their changed lines split into code and comment lines. Cached
 * splits cost nothing; the rest are worked out a few at a time on the tokenizer worker, and the
 * answer waits at most the budget for them: a file not done by then counts as code in this answer,
 * and once the rest are done `onLate` says the next answer would differ. Binary files and files
 * whose patch was too large (no patch), languages without a grammar, files over the whole-file
 * context limits, and every file of a diff listing more than MAX_CLASSIFIED_FILES count as code.
 * Never rejects.
 */
export async function classifyComments(
  ws: Workspace,
  range: DiffRange,
  files: ListedFile[],
  tokenizer: Tokenizer,
  { budgetMs = CLASSIFY_BUDGET_MS, onLate }: ClassifyOptions = {}
): Promise<DiffFile[]> {
  const candidates = files.filter(
    (f): f is ListedFile & { patch: string } =>
      f.patch !== null && f.additions + f.deletions > 0 && languageFor(f.path) !== null
  )

  if (files.length > MAX_CLASSIFIED_FILES || candidates.length === 0) {
    return files.map((f) => withSplit(f, null))
  }

  const found = new Map<ListedFile, CommentSplit>()
  let answered = false
  let late = false
  let timer: NodeJS.Timeout | undefined

  try {
    const ids = await blobIds(ws, range)

    const all = Promise.all(
      candidates.map(async (f) => {
        const split = await splitOf(ws, range, f, ids.get(f.path), tokenizer).catch(() => null)

        if (!split) return

        if (answered) late = true
        else found.set(f, split)
      })
    )

    // Only a split that landed (a plain fallback is not cached) can change the next answer.
    void all.then(() => {
      if (late) onLate?.()
    })

    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, budgetMs)
      timer.unref()
    })

    await Promise.race([all, budget])
  } catch {
    // Files not classified count as code.
  } finally {
    clearTimeout(timer)
  }

  answered = true

  return files.map((f) => withSplit(f, found.get(f) ?? null))
}
