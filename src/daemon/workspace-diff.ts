// What a workspace changed against its base, committed and uncommitted, file
// by file with patches (workspace.diff), each file's changed lines split into
// code and comments as far as that is known yet (comment-split.ts). Read-only:
// only `git diff`, `git status`, and friends.
import fs from 'node:fs'
import { join } from 'node:path'
import { splitLines } from '../shared/diff-parse'
import type { DiffFile, WorkspaceDiff } from '../shared/protocol'
import type { Project, Workspace } from '../shared/types'
import type { ListedFile } from './comment-lines'
import type { CommentClassifier } from './comment-split'
import {
  capPatch,
  type DiffOptions,
  gitRunner,
  MAX_COMMITS,
  mergeListings,
  orderBases,
  parseLog,
  parseNameStatus,
  parseNumstat,
  parsePorcelainPaths,
  resolveScope,
  type Run,
  scopeRange,
  splitPatches
} from './diff'

export async function workspaceDiff(
  ws: Workspace,
  project: Project,
  now: () => number,
  opts: DiffOptions,
  classifier: CommentClassifier
): Promise<WorkspaceDiff> {
  const run = gitRunner(ws)

  const empty = (base: string): WorkspaceDiff => ({
    workspaceId: ws.id,
    base,
    head: opts.head ?? ws.branch,
    commitsAhead: 0,
    commits: [],
    bases: [base],
    commit: null,
    files: [],
    rejectedBase: null,
    generatedAt: new Date(now()).toISOString()
  })

  if (!fs.existsSync(ws.path)) return empty(ws.baseRef)

  const scope = await resolveScope(run, ws, project, opts)
  const { base, tip, commit } = scope

  try {
    const [counted, log] = await Promise.all([
      run('rev-list', '--count', `${base}..${tip}`),
      run('log', '--format=%H%x00%s%x00%an%x00%aI', '-n', String(MAX_COMMITS), `${base}..${tip}`)
    ])

    // Never the branch being compared: comparing it against itself shows nothing.
    const refNames = scope.refs.filter((r) => r !== ws.branch && r !== opts.head)

    const result = (files: DiffFile[]): WorkspaceDiff => ({
      ...empty(base),
      rejectedBase: scope.rejectedBase,
      commitsAhead:
        counted.ok && Number.isInteger(Number(counted.stdout)) ? Number(counted.stdout) : 0,
      commits: log.ok ? parseLog(log.stdout) : [],
      bases: orderBases(base, project.defaultBranch, refNames),
      commit,
      files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    })

    const range = await scopeRange(run, scope, opts)

    if (range.to !== null) {
      return result(
        await classifier.classify(ws, range, await listFiles(run, [range.from, range.to]))
      )
    }

    const [status, others] = await Promise.all([
      run('status', '--porcelain'),
      run('ls-files', '--others', '--exclude-standard')
    ])

    const files = await listFiles(run, [range.from], parsePorcelainPaths(status.stdout))

    const seen = new Set(files.map((f) => f.path))
    const untracked = others.stdout.split('\n').filter((p) => p && !seen.has(p))

    const extra = await Promise.all(
      untracked.map(async (path): Promise<ListedFile> => {
        let text: string | null = null

        try {
          const buf = await fs.promises.readFile(join(ws.path, path))
          text = buf.includes(0) ? null : buf.toString('utf8')
        } catch {
          text = null
        }

        const file: ListedFile = {
          path,
          from: null,
          status: 'untracked',
          additions: text === null ? 0 : splitLines(text).length,
          deletions: 0,
          dirty: true,
          patch: null
        }

        if (text === null) return file
        const p = await run('diff', '--no-index', '--', '/dev/null', path)

        return { ...file, patch: capPatch(p.stdout) }
      })
    )

    return result(await classifier.classify(ws, range, [...files, ...extra]))
  } catch {
    return empty(ws.baseRef)
  }
}

/**
 * The tracked files changed across `range` (one rev: it against the working
 * tree; two: the first against the second), each with its patch. One
 * `git diff -M` gives every patch, in the order numstat lists the files; a
 * file's own `git diff` is the fallback when the two do not line up.
 */
async function listFiles(
  run: Run,
  range: string[],
  dirty = new Set<string>()
): Promise<ListedFile[]> {
  const [numstat, names, full] = await Promise.all([
    run('diff', '--numstat', '-M', ...range),
    run('diff', '--name-status', '-M', ...range),
    run('diff', '-M', ...range)
  ])

  const entries = parseNumstat(numstat.stdout)
  const binary = new Set(entries.filter((e) => e.binary).map((e) => e.path))
  const listed = mergeListings(entries, parseNameStatus(names.stdout), dirty)
  const patches = full.ok ? splitPatches(full.stdout) : []

  if (patches.length === listed.length) {
    return listed.map((f, i) => ({
      ...f,
      patch: binary.has(f.path) ? null : capPatch(patches[i] ?? '')
    }))
  }

  return Promise.all(
    listed.map(async (f): Promise<ListedFile> => {
      if (binary.has(f.path)) return { ...f, patch: null }

      const args = f.from
        ? ['diff', '-M', ...range, '--', f.from, f.path]
        : ['diff', ...range, '--', f.path]

      const p = await run(...args)

      return { ...f, patch: p.ok ? capPatch(p.stdout) : null }
    })
  )
}
