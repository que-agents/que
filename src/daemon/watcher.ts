// Watches the worktrees of workspaces that have a window attached and says
// when something changed: `emit(id)` at most once per debounce window per
// workspace. It computes nothing; clients re-ask for the diff or the files.
//
// Each watched workspace has two recursive watches: the worktree itself
// (minus its `.git` entry) and its gitdir, where only the files a commit,
// checkout, reset or stage touches count (not object writes). A linked
// worktree's `.git` is a file pointing at `<repo>/.git/worktrees/<name>`;
// a main worktree's `.git` is the gitdir itself.
import fs from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/** Whether a path reported under the worktree is a change worth telling. */
export function isWorktreeChange(rel: string): boolean {
  return rel !== '.git' && !rel.startsWith('.git/')
}

const GITDIR_FILES = new Set(['HEAD', 'ORIG_HEAD', 'index', 'packed-refs'])

/** Whether a path reported under the gitdir moves HEAD, the index or a ref. */
export function isGitdirChange(rel: string): boolean {
  return GITDIR_FILES.has(rel) || rel.startsWith('logs/') || rel.startsWith('refs/')
}

/** The absolute gitdir named by a `.git` file's `gitdir:` line, or null. */
export function parseGitdirPointer(text: string, worktreePath: string): string | null {
  const match = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(text)

  if (!match) return null
  const dir = match[1]

  return isAbsolute(dir) ? dir : resolve(worktreePath, dir)
}

interface Watched {
  path: string
  watchers: fs.FSWatcher[]
  timer: NodeJS.Timeout | null
}

export interface WorktreeWatcherOptions {
  /** The window after a first change in which further changes fold into one emit. Default 300 ms. */
  debounceMs?: number
  log?: (line: string) => void
}

export class WorktreeWatcher {
  private watched = new Map<string, Watched>()
  private readonly debounceMs: number
  private readonly log: (line: string) => void

  constructor(
    private readonly emit: (id: string) => void,
    opts: WorktreeWatcherOptions = {}
  ) {
    this.debounceMs = opts.debounceMs ?? 300
    this.log = opts.log ?? (() => {})
  }

  /** Starts watching a workspace's worktree; a no-op when already watched there. */
  watch(id: string, worktreePath: string): void {
    const current = this.watched.get(id)

    if (current?.path === worktreePath) return

    if (current) this.unwatch(id)

    let root: string
    let gitdir: string

    try {
      root = fs.realpathSync(worktreePath)
      const dotGit = join(root, '.git')

      if (fs.statSync(dotGit).isDirectory()) {
        gitdir = dotGit
      } else {
        const pointer = parseGitdirPointer(fs.readFileSync(dotGit, 'utf8'), root)

        if (!pointer) {
          this.log(`watcher: ${dotGit} is not a gitdir pointer; not watching ${id}`)

          return
        }

        gitdir = fs.realpathSync(pointer)
      }
    } catch (err) {
      this.log(`watcher: cannot watch ${id} at ${worktreePath}: ${(err as Error).message}`)

      return
    }

    const entry: Watched = { path: worktreePath, watchers: [], timer: null }
    this.watched.set(id, entry)
    this.open(id, entry, root, (rel) => rel === null || isWorktreeChange(rel))
    this.open(id, entry, gitdir, (rel) => rel !== null && isGitdirChange(rel))
  }

  unwatch(id: string): void {
    const entry = this.watched.get(id)

    if (!entry) return
    this.watched.delete(id)

    if (entry.timer) clearTimeout(entry.timer)

    for (const w of entry.watchers) w.close()
  }

  /** Watches exactly the workspaces in `wanted` (id to worktree path). */
  sync(wanted: Map<string, string>): void {
    for (const id of [...this.watched.keys()]) if (!wanted.has(id)) this.unwatch(id)

    for (const [id, path] of wanted) this.watch(id, path)
  }

  /** The ids of the workspaces being watched. */
  watching(): string[] {
    return [...this.watched.keys()]
  }

  close(): void {
    for (const id of [...this.watched.keys()]) this.unwatch(id)
  }

  private open(
    id: string,
    entry: Watched,
    dir: string,
    counts: (rel: string | null) => boolean
  ): void {
    if (this.watched.get(id) !== entry) return

    try {
      const w = fs.watch(dir, { recursive: true }, (_event, filename) => {
        const rel = filename == null ? null : filename.toString().split('\\').join('/')

        if (counts(rel)) this.schedule(id, entry)
      })

      w.on('error', (err) => {
        this.log(`watcher: ${dir} for ${id} failed: ${err.message}`)

        if (this.watched.get(id) === entry) this.unwatch(id)
      })
      entry.watchers.push(w)
    } catch (err) {
      this.log(`watcher: cannot watch ${dir} for ${id}: ${(err as Error).message}`)
      this.unwatch(id)
    }
  }

  /** The first counted change opens the window; the rest fold into its emit. */
  private schedule(id: string, entry: Watched): void {
    if (this.watched.get(id) !== entry || entry.timer) return
    entry.timer = setTimeout(() => {
      entry.timer = null

      if (this.watched.get(id) === entry) this.emit(id)
    }, this.debounceMs)
    entry.timer.unref()
  }
}
