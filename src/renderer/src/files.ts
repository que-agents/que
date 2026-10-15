// A workspace's files as a tree for the review pane's Files tab: the worktree's
// listing joined with the Changes list's files (so a deleted file still shows),
// directories first, a directory holding only another directory folded into one
// row. Pure: building the tree, the rows an expanded set shows, and which
// directories start open.
import type { DiffFile } from '../../preload/index.d'

export interface FileNode {
  kind: 'file'
  /** The path relative to the worktree. */
  path: string
  name: string
  /** The file's entry in the Changes list, or null when it is unchanged. */
  change: DiffFile | null
}

export interface DirNode {
  kind: 'dir'
  /** The path relative to the worktree; '' for the root. A folded chain has its deepest path. */
  path: string
  /** The row's label: one segment, or a folded chain's (`renderer/src`). */
  name: string
  dirs: DirNode[]
  files: FileNode[]
  /** How many changed files sit beneath it, at any depth. */
  changed: number
}

export type TreeNode = DirNode | FileNode

/** One visible row of the tree. */
export interface TreeRow {
  node: TreeNode
  /** 1 for the root's entries. */
  level: number
  /** Whether a directory is expanded; false for a file. */
  open: boolean
}

interface RawDir {
  dirs: Map<string, RawDir>
  /** Name to full path. */
  files: Map<string, string>
}

function byName(a: { name: string }, b: { name: string }): number {
  const x = a.name.toLowerCase()
  const y = b.name.toLowerCase()
  if (x !== y) return x < y ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/** The tree of the listing's paths and the changed files' paths, with each changed file's entry. */
export function buildTree(
  paths: readonly string[],
  changed: ReadonlyMap<string, DiffFile>
): DirNode {
  const root: RawDir = { dirs: new Map(), files: new Map() }
  const add = (path: string): void => {
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()
    if (name === undefined) return
    let at = root
    for (const part of parts) {
      let next = at.dirs.get(part)
      if (!next) {
        next = { dirs: new Map(), files: new Map() }
        at.dirs.set(part, next)
      }
      at = next
    }
    at.files.set(name, path)
  }
  for (const p of paths) add(p)
  for (const p of changed.keys()) add(p)

  const convert = (raw: RawDir, path: string, name: string): DirNode => {
    let dir = raw
    let at = path
    let label = name
    // A directory whose only entry is another directory folds into one row.
    while (at !== '' && dir.files.size === 0 && dir.dirs.size === 1) {
      const [childName, child] = [...dir.dirs][0]
      dir = child
      at = `${at}/${childName}`
      label = `${label}/${childName}`
    }
    const dirs = [...dir.dirs]
      .map(([n, d]) => convert(d, at === '' ? n : `${at}/${n}`, n))
      .sort(byName)
    const files: FileNode[] = [...dir.files]
      .map(([n, p]) => ({
        kind: 'file' as const,
        path: p,
        name: n,
        change: changed.get(p) ?? null
      }))
      .sort(byName)
    const count =
      dirs.reduce((n, d) => n + d.changed, 0) + files.filter((f) => f.change !== null).length
    return { kind: 'dir', path: at, name: label, dirs, files, changed: count }
  }
  return convert(root, '', '')
}

/** The rows the tree shows: each directory's entries only while it is in the expanded set. */
export function flatten(tree: DirNode, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (dir: DirNode, level: number): void => {
    for (const d of dir.dirs) {
      const open = expanded.has(d.path)
      rows.push({ node: d, level, open })
      if (open) walk(d, level + 1)
    }
    for (const f of dir.files) rows.push({ node: f, level, open: false })
  }
  walk(tree, 1)
  return rows
}

/** The directories open when a workspace's files first load: those with a changed file beneath. */
export function defaultExpanded(tree: DirNode): Set<string> {
  const open = new Set<string>()
  const walk = (dir: DirNode): void => {
    for (const d of dir.dirs) {
      if (d.changed === 0) continue
      open.add(d.path)
      walk(d)
    }
  }
  walk(tree)
  return open
}
