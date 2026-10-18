import { useEffect, useRef } from 'react'
import { useQue } from '../store'
import { useDismiss } from '../useDismiss'

export interface MenuItem {
  label: string
  testId: string
  action: () => void
  /** Marks the current choice in a menu of choices (a `menuitemradio`); omitted for plain actions. */
  selected?: boolean
  /** Shown as the item's tooltip. */
  title?: string
  /** The value an item stands for when its test id is an index (a branch name), as `data-ref`. */
  dataRef?: string
}

export interface Point {
  x: number
  y: number
}

const MENU_WIDTH = 180
const MENU_ITEM_HEIGHT = 28

/**
 * A popup menu. Anchored under its button, or placed at the pointer for a
 * right-click (kept inside the window). The selected item, else the first,
 * takes focus; Escape or a click elsewhere (outside `anchor` too) closes it.
 * Items are disabled while the daemon is unreachable.
 */
export default function Menu({
  label,
  testId,
  items,
  at,
  className,
  anchor,
  onClose
}: {
  label: string
  testId: string
  items: MenuItem[]
  at?: Point
  /** Extra classes, for placement. */
  className?: string
  /** The button that opens the menu: a press on it is left to its own toggle. */
  anchor?: React.RefObject<HTMLElement | null>
  onClose: () => void
}): React.JSX.Element {
  const { connected } = useQue()
  const ref = useRef<HTMLDivElement>(null)

  const noAnchor = useRef<HTMLElement>(null)
  useDismiss(onClose, ref, anchor ?? noAnchor)

  useEffect(() => {
    const menu = ref.current

    const first =
      menu?.querySelector<HTMLElement>('[aria-checked=true]') ??
      menu?.querySelector<HTMLElement>('[role^=menuitem]')

    first?.focus()
  }, [onClose, anchor])

  const style = at
    ? {
        left: Math.max(0, Math.min(at.x, window.innerWidth - MENU_WIDTH)),
        top: Math.max(0, Math.min(at.y, window.innerHeight - MENU_ITEM_HEIGHT * items.length - 12)),
        right: 'auto'
      }
    : undefined

  const classes = ['menu', at && 'at-pointer', className].filter(Boolean).join(' ')

  return (
    <div className={classes} role="menu" aria-label={label} ref={ref} style={style}>
      {items.map((item) => {
        const common = {
          type: 'button' as const,
          title: item.title,
          'data-testid': `${testId}-${item.testId}`,
          'data-ref': item.dataRef,
          disabled: !connected,
          onClick: () => {
            onClose()
            item.action()
          }
        }

        return item.selected === undefined ? (
          <button key={item.testId} role="menuitem" {...common}>
            {item.label}
          </button>
        ) : (
          <button key={item.testId} role="menuitemradio" aria-checked={item.selected} {...common}>
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
