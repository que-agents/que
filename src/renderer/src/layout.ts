// A workspace's tabs in one or two panes: its terminals, then its view tabs
// (Changes, Pull request). Pure: parsing a remembered layout and fitting it to
// the terminals that still exist.

/** A tab that shows a view of the workspace instead of a terminal. */
export type ViewKind = 'changes' | 'pr'

export const VIEW_KINDS: readonly ViewKind[] = ['changes', 'pr']

/** The tab id of a view: `view:changes`, `view:pr`. */
export function viewId(kind: ViewKind): string {
  return `view:${kind}`
}

/** The view a tab id names, or null for a terminal id. */
export function viewKindOf(id: string | null): ViewKind | null {
  if (!id?.startsWith('view:')) return null
  const kind = id.slice('view:'.length)
  return (VIEW_KINDS as readonly string[]).includes(kind) ? (kind as ViewKind) : null
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
  /** The open view tabs, in the order they were opened. */
  views: ViewKind[]
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
    const views: ViewKind[] = []
    if (Array.isArray(v?.views)) {
      for (const k of v.views) {
        if ((VIEW_KINDS as readonly unknown[]).includes(k) && !views.includes(k)) views.push(k)
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
  const views = l.views.map(viewId)
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
