// que's icons: 16px line drawings at a 1.5px stroke, in the current text
// colour, inline so the app needs no icon font or library. Each is decorative;
// the button around it carries the accessible name.
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  focusable: false
} as const

/** A folder with a plus on its bottom-right corner: add a repository. */
export function FolderPlusIcon(): React.JSX.Element {
  return (
    <svg {...base} aria-hidden="true">
      <path d="M1.75 4.5a1 1 0 0 1 1-1h3.85l1.5 1.75h5.15a1 1 0 0 1 1 1v1" />
      <path d="M1.75 4.5v8.25a1 1 0 0 0 1 1h5" />
      <path d="M12.25 9.25v5M9.75 11.75h5" />
    </svg>
  )
}

/** Three horizontal lines of decreasing length: sort. */
export function SortIcon(): React.JSX.Element {
  return (
    <svg {...base} aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h7.5M2.5 12h4" />
    </svg>
  )
}

/** A rounded rectangle with a vertical line through the middle: split into two side by side. */
export function SplitBesideIcon(): React.JSX.Element {
  return (
    <svg {...base} aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M8 3v10" />
    </svg>
  )
}

/** A rounded rectangle with a horizontal line through the middle: split into two stacked. */
export function SplitBelowIcon(): React.JSX.Element {
  return (
    <svg {...base} aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 8h12" />
    </svg>
  )
}

/** The rectangle alone: join two panes back into one. */
export function JoinPanesIcon(): React.JSX.Element {
  return (
    <svg {...base} aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
    </svg>
  )
}

/** A plus: open or create one more of something. */
export function PlusIcon(): React.JSX.Element {
  return (
    <svg {...base} aria-hidden="true">
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </svg>
  )
}
