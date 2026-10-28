// workspace.diff's split of each file's changed lines into code and comment
// lines. The answer never waits for it: a split already known is in the
// answer, and any other file counts as code there while it is worked out in
// the background, a few files at a time on the tokenizer worker, with the
// tokenized sides workspace.diffFile shares. When a workspace's outstanding
// splits settle and any landed, `onSettled` names it (workspace.diffSettled),
// so a client asking again gets them.
import fs from 'node:fs'
import { join } from 'node:path'
import { parseHunks } from '../shared/diff-parse'
import type { DiffFile } from '../shared/protocol'
import type { Workspace } from '../shared/types'
import {
  type CommentSplit,
  countCommentLines,
  type ListedFile,
  markCommentLines,
  withSplit
} from './comment-lines'
import { type DiffRange, gitRunner, parseBatchCheck, parseRawDiff } from './diff'
import {
  FULL_CONTEXT_CHARS,
  fitsFullContext,
  Lru,
  MAX_FILE_BYTES,
  readWorktreeFile,
  tokenizeHunkLines,
  tokenizeSide
} from './diff-file'
import { languageFor } from './syntax'
import type { Tokenizer } from './tokenizer'

/** A diff listing more files than this is not split at all. */
export const MAX_CLASSIFIED_FILES = 300

/** Files worked out at once; the worker is single, so more would only queue. */
const CONCURRENCY = 4

/** Splits kept, and working-tree content ids kept by path, mtime and size. */
const SPLIT_ENTRIES = 2_000
const STAT_ENTRIES = 5_000

type Patched = ListedFile & { patch: string }

interface StatId {
  mtimeMs: number
  size: number
  id: string
}

/** Runs at most `n` tasks at once, in the order they ask. */
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

const splitKey = (
  oldId: string | null,
  newId: string | null,
  path: string,
  from: string | null
): string => JSON.stringify([oldId, newId, path, from])

export class CommentClassifier {
  /** Splits by both sides' ids and the paths; 'skip' for a file too large to classify. */
  private readonly splits = new Lru<CommentSplit | 'skip'>(SPLIT_ENTRIES)
  /** A working-tree file's content id, while its mtime and size stay the same. */
  private readonly worktreeIds = new Lru<StatId>(STAT_ENTRIES)
  /** Jobs running, by key, so overlapping calls share one; each resolves true when a split landed. */
  private readonly jobs = new Map<string, Promise<boolean>>()
  /** Per workspace: the job keys it still waits on, and whether any landed. */
  private readonly pending = new Map<string, { keys: Set<string>; landed: boolean }>()
  private readonly limit = limiter(CONCURRENCY)

  constructor(
    private readonly tokenizer: Tokenizer,
    private readonly onSettled: (workspaceId: string) => void
  ) {}

  /**
   * The files with their counts split where the split is known; every other file counts as
   * code and, when it can be classified, is queued. Binary files and files whose patch was too
   * large (no patch), languages without a grammar, files over the whole-file context limits,
   * and every file of a listing over MAX_CLASSIFIED_FILES are never classified. Never rejects.
   */
  async classify(ws: Workspace, range: DiffRange, files: ListedFile[]): Promise<DiffFile[]> {
    const candidates =
      files.length > MAX_CLASSIFIED_FILES
        ? []
        : files.filter(
            (f): f is Patched =>
              f.patch !== null && f.additions + f.deletions > 0 && languageFor(f.path) !== null
          )

    const known = new Map<ListedFile, CommentSplit>()

    if (candidates.length > 0) {
      try {
        await this.lookUp(ws, range, candidates, known)
      } catch {
        // Files not looked up count as code.
      }
    }

    return files.map((f) => withSplit(f, known.get(f) ?? null))
  }

  private async lookUp(
    ws: Workspace,
    range: DiffRange,
    files: Patched[],
    known: Map<ListedFile, CommentSplit>
  ): Promise<void> {
    const revs = range.to === null ? [range.from] : [range.from, range.to]
    const raw = await gitRunner(ws)('diff', '--raw', '--no-abbrev', '-M', ...revs)
    const ids = parseRawDiff(raw.stdout)
    const inWorktree = range.to === null

    await Promise.all(
      files.map(async (f) => {
        const isNew = f.status === 'added' || f.status === 'untracked'
        const present = f.status !== 'deleted'
        const oldId = isNew ? null : (ids.get(f.path)?.oldId ?? null)

        // A side git could not name is not guessed at.
        if (!isNew && oldId === null) return

        if (!inWorktree) {
          const newId = present ? (ids.get(f.path)?.newId ?? null) : null

          if (present && newId === null) return
          this.lookUpKey(ws, f, splitKey(oldId, newId, f.path, f.from), known, () =>
            this.work(ws, f, oldId, newId, null)
          )

          return
        }

        if (!present) {
          this.lookUpKey(ws, f, splitKey(oldId, null, f.path, f.from), known, () =>
            this.work(ws, f, oldId, null, null)
          )

          return
        }

        // A working-tree file is known by its content id, kept while its mtime and size stay.
        const file = join(ws.path, f.path)
        const stat = await fs.promises.stat(file).catch(() => null)

        if (!stat?.isFile() || stat.size > FULL_CONTEXT_CHARS) return
        const seen = this.worktreeIds.get(file)

        if (seen && seen.mtimeMs === stat.mtimeMs && seen.size === stat.size) {
          this.lookUpKey(ws, f, splitKey(oldId, seen.id, f.path, f.from), known, () =>
            this.work(ws, f, oldId, seen.id, null)
          )

          return
        }

        // Read and hashed only in the job, then looked up again by its id.
        const pre = JSON.stringify(['stat', oldId, f.path, f.from, stat.mtimeMs, stat.size])

        this.track(ws.id, pre, () =>
          this.work(ws, f, oldId, null, { file, mtimeMs: stat.mtimeMs, size: stat.size })
        )
      })
    )
  }

  /** Puts a known split in the answer, or queues the job that works it out. */
  private lookUpKey(
    ws: Workspace,
    f: Patched,
    key: string,
    known: Map<ListedFile, CommentSplit>,
    work: () => Promise<boolean>
  ): void {
    const hit = this.splits.get(key)

    if (hit === undefined) this.track(ws.id, key, work)
    else if (hit !== 'skip') known.set(f, hit)
  }

  /** Starts the job for `key` unless it runs, and counts it against the workspace. */
  private track(workspaceId: string, key: string, start: () => Promise<boolean>): void {
    let job = this.jobs.get(key)

    if (!job) {
      job = this.limit(start)
        .catch(() => false)
        .finally(() => this.jobs.delete(key))
      this.jobs.set(key, job)
    }

    let waits = this.pending.get(workspaceId)

    if (!waits) {
      waits = { keys: new Set(), landed: false }
      this.pending.set(workspaceId, waits)
    }

    if (waits.keys.has(key)) return
    waits.keys.add(key)
    const mine = waits

    void job.then((landed) => {
      mine.landed ||= landed
      mine.keys.delete(key)

      if (mine.keys.size > 0) return
      this.pending.delete(workspaceId)

      // Only a split that landed changes the next answer; a plain fallback is not kept.
      if (mine.landed) this.onSettled(workspaceId)
    })
  }

  /**
   * Works out one file's split and keeps it; true when a split landed. A working-tree file
   * (`stat` given) is read and hashed here first, and may turn out to be known already.
   */
  private async work(
    ws: Workspace,
    f: Patched,
    oldId: string | null,
    knownNewId: string | null,
    stat: { file: string; mtimeMs: number; size: number } | null
  ): Promise<boolean> {
    let newId = knownNewId
    let newText: string | null = null

    if (stat) {
      const read = await readWorktreeFile(ws, f.path)

      if (!read?.id) return false
      this.worktreeIds.set(stat.file, { mtimeMs: stat.mtimeMs, size: stat.size, id: read.id })
      newId = read.id
      newText = read.text
    }

    const key = splitKey(oldId, newId, f.path, f.from)
    const hit = this.splits.get(key)

    if (hit !== undefined) return hit !== 'skip'

    const blobs = [oldId, newText === null ? newId : null].filter((id): id is string => id !== null)

    const sizes =
      blobs.length === 0
        ? new Map<string, number>()
        : parseBatchCheck(
            (await gitRunner(ws, { input: `${blobs.join('\n')}\n` })('cat-file', '--batch-check'))
              .stdout
          )

    if (blobs.some((id) => (sizes.get(id) ?? 0) > FULL_CONTEXT_CHARS)) {
      this.splits.set(key, 'skip')

      return false
    }

    const raw = gitRunner(ws, { trim: false, maxBuffer: 4 * MAX_FILE_BYTES })

    const readBlob = async (id: string | null): Promise<string> =>
      id === null ? '' : (await raw('cat-file', 'blob', id)).stdout

    const [oldText, text] = await Promise.all([readBlob(oldId), newText ?? readBlob(newId)])

    if (oldText.includes('\0') || text.includes('\0') || !fitsFullContext(oldText, text)) {
      this.splits.set(key, 'skip')

      return false
    }

    const language = languageFor(f.path)

    const [before, after] = await Promise.all([
      tokenizeSide(this.tokenizer, oldId, oldText, language),
      tokenizeSide(this.tokenizer, newId, text, language)
    ])

    // A file the tokenizer failed on counts as code now and is tried again next time.
    if (before.degraded || after.degraded) return false

    // The list's own patch (git's default context, whitespace shown) gives the changed lines.
    const lines = parseHunks(f.patch).flatMap((h) =>
      markCommentLines(tokenizeHunkLines(h.lines, before.lines, after.lines))
    )

    this.splits.set(key, countCommentLines(lines))

    return true
  }
}
