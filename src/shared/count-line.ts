// A count line: a handful of counts in one faint mono line, `2 running · 1
// waiting · 3 done`, the dim way que reports totals (the quiet board, the
// report page). Builders return only the counts that are non-zero; this module
// only knows how to write them out. No Node imports.

/** One count on a count line: `3 done`, `1 paused (limit resets 03:00)`. */
export interface CountItem {
  count: number
  /** The word after the number: `running`, `waiting`, `done`. */
  label: string
  /**
   * The one colour the item may take: a status tone (`bad` for stuck,
   * `attention`) or `muted`, one notch brighter than the faint line. Absent,
   * the item stays faint.
   */
  tone?: 'bad' | 'attention' | 'muted'
  /** Detail in brackets after the label: `limit resets 03:00`. */
  note?: string
}

/** The separator between items, as text. */
export const COUNT_SEPARATOR = ' · '

/** One item as text: `1 paused (limit resets 03:00)`. */
export function countItemText(item: CountItem): string {
  return `${item.count} ${item.label}${item.note ? ` (${item.note})` : ''}`
}

/** The whole line as text: `2 running · 1 waiting`; empty for no items. */
export function countLineText(items: readonly CountItem[]): string {
  return items.map(countItemText).join(COUNT_SEPARATOR)
}
