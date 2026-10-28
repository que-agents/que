// One file's diff as hunks of tokenized lines (workspace.diffFile), in the same
// scopes as workspace.diff. Both sides are read whole and tokenized whole, so
// a line's colours come from the file, not from the patch fragment; the diff
// itself carries the whole file as context when it is small enough. The
// comment split (comment-split.ts) shares the tokenized sides.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { join } from 'node:path'
import { isBinaryPatch, parseHunks, type RawLine, splitLines } from '../shared/diff-parse'
import type {
  DiffHunk,
  DiffLine,
  DiffToken,
  WorkspaceDiffFile,
  WorkspaceDiffFileParams
} from '../shared/protocol'
import type { Project, Workspace } from '../shared/types'
import {
  type DiffOptions,
  gitRunner,
  parseBatchCheck,
  parseNumstat,
  parseRawDiff,
  resolveScope,
  scopeRange
} from './diff'
import { markCommentLines } from './comment-lines'
import { badRequest, notFound } from './errors'
import { insideWorktree } from './files'
import { languageFor, type TokenizedFile } from './syntax'
import type { Tokenizer, TokenizeResult } from './tokenizer'
import { markBudget, markChangeBlocks } from './word-marks'

/** Both sides at most this many lines (and FULL_CONTEXT_CHARS) get whole-file context. */
export const FULL_CONTEXT_LINES = 5_000
export const FULL_CONTEXT_CHARS = 400_000

/** Either side larger than this many bytes is not diffed at all. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024

/** Results kept for unchanged files, bounded by their lines in all. */
const RESULT_CACHE_LINES = 250_000

/** Tokenized sides kept, bounded by their lines in all. */
const SIDE_CACHE_LINES = 250_000

/** The file-level part of a result: everything but the scope it was asked in. Shared by the cache: never changed. */
type FileDiff = Readonly<
  Pick<
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
>

/** A least-recently-used map bounded by the summed weight of its entries. */
export class Lru<V> {
  private readonly map = new Map<string, { value: V; weight: number }>()
  private total = 0

  constructor(
    private readonly maxWeight: number,
    private readonly weigh: (value: V) => number = () => 1
  ) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key)

    if (entry === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, entry)

    return entry.value
  }

  /** Keeps `value`, dropping the least recently used entries past the bound; one heavier than the bound is not kept. */
  set(key: string, value: V): void {
    this.drop(key)
    const weight = Math.max(1, this.weigh(value))

    if (weight > this.maxWeight) return
    this.map.set(key, { value, weight })
    this.total += weight

    while (this.total > this.maxWeight) {
      const oldest = this.map.keys().next()

      if (oldest.done) break
      this.drop(oldest.value)
    }
  }

  private drop(key: string): void {
    const entry = this.map.get(key)

    if (!entry) return
    this.map.delete(key)
    this.total -= entry.weight
  }
}

const results = new Lru<FileDiff>(RESULT_CACHE_LINES, (f) =>
  f.hunks.reduce((n, h) => n + h.lines.length, 0)
)

const sides = new Lru<TokenizedFile>(SIDE_CACHE_LINES, (t) => t.lines.length)

const sideKey = (id: string, language: string | null): string => `${id}\0${language ?? ''}`

/**
 * A file side tokenized earlier for workspace.diffFile, by its id (a git blob
 * id, or `worktree:<sha1 of the content>` for a working-tree file) and
 * language; undefined when it is not cached. Shared: never change it.
 */
export function cachedSideTokens(id: string, language: string | null): TokenizedFile | undefined {
  return sides.get(sideKey(id, language))
}

/** One side's tokens, from the shared cache when it has them; a result that is not degraded is kept. */
export async function tokenizeSide(
  tokenizer: Tokenizer,
  id: string | null,
  text: string,
  language: string | null
): Promise<TokenizeResult> {
  const key = id === null ? null : sideKey(id, language)
  const hit = key === null ? undefined : sides.get(key)

  if (hit) return { ...hit, degraded: false }
  const result = await tokenizer.tokenizeFile(text, language)

  if (key !== null && !result.degraded) {
    sides.set(key, { language: result.language, lines: result.lines })
  }

  return result
}

/** Whole-file context fits when both sides are small. */
export function fitsFullContext(before: string, after: string): boolean {
  return [before, after].every(
    (t) => t.length <= FULL_CONTEXT_CHARS && splitLines(t).length <= FULL_CONTEXT_LINES
  )
}

/** True when the tokens spell exactly `text`. */
function spells(tokens: readonly DiffToken[], text: string): boolean {
  let at = 0

  for (const t of tokens) {
    if (!text.startsWith(t.text, at)) return false
    at += t.text.length
  }

  return at === text.length
}

/**
 * Lays each raw line's tokens on from the tokenized sides, sharing their token
 * arrays; a line neither side spells is one plain token.
 */
export function tokenizeHunkLines(
  lines: readonly RawLine[],
  before: readonly DiffToken[][],
  after: readonly DiffToken[][]
): DiffLine[] {
  return lines.map((l) => {
    const fromNew = l.new === null ? undefined : after[l.new - 1]
    const fromOld = l.old === null ? undefined : before[l.old - 1]
    // A context line under -w may differ in whitespace from one side: whichever matches.
    const preferred = l.kind === 'removed' ? [fromOld] : [fromNew, fromOld]
    const tokens = preferred.find((t) => t !== undefined && spells(t, l.text))

    return {
      kind: l.kind,
      old: l.old,
      new: l.new,
      tokens: tokens ?? (l.text === '' ? [] : [{ text: l.text, kind: 'plain' }])
    }
  })
}

/** The structured hunks of a patch, tokens laid on, comment lines flagged, and word marks set (within one budget for the file). */
export function buildHunks(
  patch: string,
  before: readonly DiffToken[][],
  after: readonly DiffToken[][]
): DiffHunk[] {
  const budget = markBudget()

  return parseHunks(patch).map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    label: h.label,
    lines: markCommentLines(markChangeBlocks(tokenizeHunkLines(h.lines, before, after), budget))
  }))
}

/** A working-tree file: its content id, size, and text (null when over the cap or not a file). */
export async function readWorktreeFile(
  ws: Workspace,
  path: string
): Promise<{ id: string | null; size: number; text: string } | null> {
  const file = join(ws.path, path)

  try {
    const stat = await fs.promises.stat(file)

    if (!stat.isFile()) return null

    if (stat.size > MAX_FILE_BYTES) return { id: null, size: stat.size, text: '' }
    const buf = await fs.promises.readFile(file)

    return {
      id: `worktree:${createHash('sha1').update(buf).digest('hex')}`,
      size: buf.length,
      text: buf.toString('utf8')
    }
  } catch {
    return null
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
  const raw = gitRunner(ws, { trim: false, maxBuffer: 4 * MAX_FILE_BYTES })
  const scope = await resolveScope(run, ws, project, opts)
  const range = await scopeRange(run, scope, opts)
  const revs = range.to === null ? [range.from] : [range.from, range.to]
  const inWorktree = range.to === null

  // Every changed file's status and blob ids at once; the working-tree file is read meanwhile.
  const [listing, worktreeFile] = await Promise.all([
    run('diff', '--raw', '--no-abbrev', '-M', ...revs),
    inWorktree ? readWorktreeFile(ws, path) : null
  ])

  let entry = parseRawDiff(listing.stdout).get(path)

  if (!entry && inWorktree) {
    const others = await run('ls-files', '--others', '--exclude-standard', '--', path)

    if (others.stdout.split('\n').includes(path)) {
      entry = { path, from: null, status: 'untracked', oldId: null, newId: null }
    }
  }

  if (!entry) throw notFound(`${path} has no changes in this diff`)
  const { status, from } = entry
  const oldId = entry.oldId
  const present = status !== 'deleted'
  const newId = present ? (inWorktree ? (worktreeFile?.id ?? null) : entry.newId) : null
  const blobs = [oldId, inWorktree ? null : newId].filter((id): id is string => id !== null)

  const sizes =
    blobs.length === 0
      ? new Map<string, number>()
      : parseBatchCheck(
          (await gitRunner(ws, { input: `${blobs.join('\n')}\n` })('cat-file', '--batch-check'))
            .stdout
        )

  const sizeOf = (id: string | null): number => (id === null ? 0 : (sizes.get(id) ?? 0))
  const newSize = inWorktree ? (present ? (worktreeFile?.size ?? 0) : 0) : sizeOf(newId)
  const flags = whitespace === 'ignore' ? ['-w'] : []

  const diffArgs = (extra: string[]): string[] =>
    status === 'untracked'
      ? ['diff', '--no-index', '--no-color', '--no-ext-diff', ...flags, ...extra].concat([
          '--',
          '/dev/null',
          path
        ])
      : ['diff', '--no-color', '--no-ext-diff', '-M', ...flags, ...extra, ...revs, '--'].concat(
          from ? [from, path] : [path]
        )

  // The cached object is shared, never changed: the scope goes on top of it.
  const scoped = (file: FileDiff): WorkspaceDiffFile => ({
    ...file,
    workspaceId: ws.id,
    base: scope.base,
    head: params.head ?? ws.branch,
    commit: scope.commit
  })

  const skippedResult = async (skipped: 'binary' | 'too-large'): Promise<WorkspaceDiffFile> => {
    // A binary file has no line counts; a too-large one still has git's.
    const counted =
      skipped === 'too-large'
        ? parseNumstat((await raw(...diffArgs(['--numstat']))).stdout)[0]
        : undefined

    return scoped({
      path,
      from,
      status,
      whitespace,
      fullContext: false,
      language: null,
      skipped,
      additions: counted?.additions ?? 0,
      deletions: counted?.deletions ?? 0,
      hunks: []
    })
  }

  if (sizeOf(oldId) > MAX_FILE_BYTES || newSize > MAX_FILE_BYTES) return skippedResult('too-large')

  const key = JSON.stringify([oldId, newId, path, from, whitespace])
  const hit = results.get(key)

  if (hit) return scoped(hit)

  const readBlob = async (id: string | null): Promise<string> =>
    id === null ? '' : (await raw('cat-file', 'blob', id)).stdout

  const [oldText, newText] = await Promise.all([
    readBlob(oldId),
    inWorktree ? (present ? (worktreeFile?.text ?? '') : '') : readBlob(newId)
  ])

  if (oldText.includes('\0') || newText.includes('\0')) return skippedResult('binary')
  const fullContext = fitsFullContext(oldText, newText)

  const context = fullContext
    ? [`-U${Math.max(splitLines(oldText).length, splitLines(newText).length, 1)}`]
    : []

  const language = languageFor(path)

  const [patch, oldTokens, newTokens] = await Promise.all([
    raw(...diffArgs(context)).then((r) => r.stdout),
    tokenizeSide(tokenizer, oldId, oldText, language),
    tokenizeSide(tokenizer, newId, newText, language)
  ])

  if (isBinaryPatch(patch)) return skippedResult('binary')
  const hunks = buildHunks(patch, oldTokens.lines, newTokens.lines)
  let additions = 0
  let deletions = 0

  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind === 'added') additions += 1
      else if (l.kind === 'removed') deletions += 1
    }
  }

  const file: FileDiff = {
    path,
    from,
    status,
    whitespace,
    fullContext,
    language: newTokens.language ?? oldTokens.language,
    skipped: null,
    additions,
    deletions,
    hunks
  }

  // A result coloured plain because the tokenizer failed is not kept: the next ask tries again.
  if (!oldTokens.degraded && !newTokens.degraded) results.set(key, file)

  return scoped(file)
}
