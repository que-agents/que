// A workspace's tabs in one or two panes: its terminals, then its view tabs: a
// changed file's diff, or a file of the worktree read-only. Pure: parsing a
// remembered layout and fitting it to the terminals that still exist.

const DIFF_PREFIX = 'view:diff:'
const FILE_PREFIX = 'view:file:'

/** The tab id of a file's diff: `view:diff:<path>`, the path verbatim. */
export function diffId(path: string): string {
  return DIFF_PREFIX + path
}

/** The file a diff tab id shows, or null for any other id (a terminal's). */
export function diffPathOf(id: string | null): string | null {
  if (!id?.startsWith(DIFF_PREFIX)) return null
  const path = id.slice(DIFF_PREFIX.length)

  return path === '' ? null : path
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
  return diffPathOf(id) !== null || filePathOf(id) !== null
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

/** Whether a layout differs from a single pane with no view tabs (and so is worth remembering). */
export function isRemembered(l: PaneLayout): boolean {
  return Boolean(l.split) || l.views.length > 0
}

/** Parses a remembered layout; null when it is neither a split nor holds a view tab. */
export function parseLayout(raw: string | null): PaneLayout | null {
  if (!raw) return null

  try {
    const v = JSON.parse(raw) as Partial<PaneLayout> | null
    const sp = v?.split

    const split =
      sp && (sp.direction === 'row' || sp.direction === 'column')
        ? { direction: sp.direction, ratio: clampRatio(Number(sp.ratio)) }
        : null

    const views: string[] = []

    if (Array.isArray(v?.views)) {
      for (const k of v.views as unknown[]) {
        if (typeof k === 'string' && isViewId(k) && !views.includes(k)) views.push(k)
      }
    }

    if (!split && views.length === 0) return null
    const id = (x: unknown): string | null => (typeof x === 'string' ? x : null)

    if (!split) return { ...NO_SPLIT, active: [id(v?.active?.[0]), null], views }

    return {
      split,
      second: Array.isArray(v?.second) ? v.second.filter((x) => typeof x === 'string') : [],
      active: [id(v?.active?.[0]), id(v?.active?.[1])],
      focused: v?.focused === 1 ? 1 : 0,
      views
    }
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
