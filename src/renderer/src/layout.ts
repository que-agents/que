// A workspace's tabs in one or two panes: its terminals, then its view tabs: a
// changed file's diff, or a file of the worktree read-only. Pure: parsing a
// remembered layout and fitting it to the terminals that still exist.
import { decodeLayout } from './persisted.decode'

const DIFF_PREFIX = 'view:diff:'
const FILE_PREFIX = 'view:file:'

/**
 * What a diff compares instead of the worktree: a branch's own committed files against a base
 * (a pull request's head and base; an empty base is the daemon's default).
 */
export interface DiffAgainst {
  head: string
  base: string
}

/** A diff tab: the file it shows, and the branch and base when it is not the worktree's. */
export interface DiffTab {
  path: string
  against?: DiffAgainst
}

/**
 * The tab id of a file's diff: `view:diff:<path>`, the path verbatim; against a branch,
 * `view:diff:<head>\0<base>\0<path>`. Neither a ref nor a path can hold a NUL, so the two
 * never collide.
 */
export function diffId(path: string, against?: DiffAgainst): string {
  return DIFF_PREFIX + (against ? `${against.head}\0${against.base}\0${path}` : path)
}

/** The diff a diff tab id shows, or null for any other id (a terminal's). */
export function diffOf(id: string | null): DiffTab | null {
  if (!id?.startsWith(DIFF_PREFIX)) return null
  const parts = id.slice(DIFF_PREFIX.length).split('\0')

  if (parts.length === 1) return parts[0] === '' ? null : { path: parts[0] }
  const [head, base, path] = parts

  return parts.length === 3 && head !== '' && path !== '' ? { path, against: { head, base } } : null
}

/** The tab id of a worktree file's view: `view:file:<path>`, the path verbatim. */
export function fileId(path: string): string {
  return FILE_PREFIX + path
}

/** The file a file tab id shows, or null for any other id. */
export function filePathOf(id: string | null): string | null {
  if (!id?.startsWith(FILE_PREFIX)) return null
  const path = id.slice(FILE_PREFIX.length)

  return path === '' ? null : path
}

/** Whether a tab id is a view tab (a diff or a file) rather than a terminal. */
export function isViewId(id: string | null): boolean {
  return diffOf(id) !== null || filePathOf(id) !== null
}

/** One workspace's tabs in one or two panes (a tree of depth one). */
export interface PaneLayout {
  /** null: one pane. Otherwise the second pane sits beside (row) or below (column) the first. */
  split: { direction: 'row' | 'column'; ratio: number } | null
  /** Tab ids (terminal or view) shown in the second pane; every other tab of the key is in the first. */
  second: string[]
  /** The selected tab id per pane; null means the pane's newest tab. */
  active: [string | null, string | null]
  focused: 0 | 1
  /** The open view tab ids (`view:diff:<path>`), in the order they were opened. */
  views: string[]
}

export const RATIO_MIN = 0.2
export const RATIO_MAX = 0.8
export const RATIO_DEFAULT = 0.5

export const NO_SPLIT: PaneLayout = {
  split: null,
  second: [],
  active: [null, null],
  focused: 0,
  views: []
}

export function clampRatio(r: number): number {
  const n = Number.isFinite(r) ? r : RATIO_DEFAULT

  return Math.round(Math.min(RATIO_MAX, Math.max(RATIO_MIN, n)) * 1000) / 1000
}

/**
 * The layout with a tab selected in a pane, and that pane focused. With `append`, the id is a new
 * tab: added to the second pane's list when it goes there (the first pane holds every other tab).
 */
export function placeIn(
  l: PaneLayout,
  pane: 0 | 1,
  id: string,
  opts: { append: boolean }
): PaneLayout {
  return {
    ...l,
    second: opts.append && pane === 1 ? [...l.second, id] : l.second,
    active: pane === 0 ? [id, l.active[1]] : [l.active[0], id],
    focused: pane
  }
}

/** Whether a layout differs from a single pane with no view tabs (and so is worth remembering). */
export function isRemembered(l: PaneLayout): boolean {
  return Boolean(l.split) || l.views.length > 0
}

/** Parses a remembered layout; null when it is neither a split nor holds a view tab. */
export function parseLayout(raw: string | null): PaneLayout | null {
  if (!raw) return null

  try {
    const v = decodeLayout(JSON.parse(raw))

    if (!v) return null

    const split = v.split
      ? { direction: v.split.direction, ratio: clampRatio(v.split.ratio) }
      : null

    const views: string[] = []

    for (const k of v.views) {
      if (isViewId(k) && !views.includes(k)) views.push(k)
    }

    if (!split && views.length === 0) return null

    if (!split) return { ...NO_SPLIT, active: [v.active[0], null], views }

    return { split, second: v.second, active: v.active, focused: v.focused, views }
  } catch {
    return null
  }
}

/**
 * The layout with ids of vanished terminals dropped; view tabs stay while they
 * are open. A split whose second pane is empty collapses; one whose first pane
 * is empty hands over the second. A pane holding only a view tab is not empty.
 */
export function reconcileLayout(
  l: PaneLayout,
  ids: ReadonlySet<string>,
  tabIds: string[]
): PaneLayout {
  if (!l.split) return l
  const views = l.views
  const live = (id: string): boolean => ids.has(id) || views.includes(id)
  const second = l.second.filter(live)

  const active: [string | null, string | null] = [
    l.active[0] && live(l.active[0]) && !second.includes(l.active[0]) ? l.active[0] : null,
    l.active[1] && second.includes(l.active[1]) ? l.active[1] : null
  ]

  const firstCount = [...tabIds, ...views].filter((id) => !second.includes(id)).length

  if (second.length === 0) return { ...NO_SPLIT, views: l.views, active: [active[0], null] }

  if (firstCount === 0) return { ...NO_SPLIT, views: l.views, active: [active[1], null] }

  return { ...l, second, active }
}
