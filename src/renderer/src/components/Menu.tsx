import { useEffect, useRef } from 'react'
import { useQue } from '../store'
import { useDismiss } from '../useDismiss'

export interface MenuItem {
  label: string
  testId: string
  action: () => void
  /** Marks the current choice in a menu of choices (a `menuitemradio`); omitted for plain actions. */
  selected?: boolean
  /** An option that is on or off (a `menuitemcheckbox`, ✓ while on); omitted for the others. */
  checked?: boolean
  /** A word at the item's right end, faint: what the choice means. */
  hint?: string
  /** A hairline above the item, setting it apart from those before it. */
  separated?: boolean
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

/** An item's role and checked state: a choice among several, an option on or off, or an action. */
interface ItemRole {
  role: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox'
  'aria-checked'?: boolean
}

function itemRole(item: MenuItem): ItemRole {
  if (item.checked !== undefined) return { role: 'menuitemcheckbox', 'aria-checked': item.checked }

  if (item.selected !== undefined) return { role: 'menuitemradio', 'aria-checked': item.selected }

  return { role: 'menuitem' }
}

/**
 * A popup menu. Anchored under its button, or placed at the pointer for a
 * right-click (kept inside the window). An optional bracketed `head` names
 * what it chooses. The selected item, else the first, takes focus; Escape or a
 * click elsewhere (outside `anchor` too) closes it, and so does picking an item.
 * Items are disabled while the daemon is unreachable.
 */
export default function Menu({
  label,
  testId,
  items,
  head,
  at,
  className,
  anchor,
  onClose
}: {
  label: string
  testId: string
  items: MenuItem[]
  /** A mono label over the items, drawn in brackets. */
  head?: string
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
      menu?.querySelector<HTMLElement>('[role=menuitemradio][aria-checked=true]') ??
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
      {head && (
        <p className="menu-head" aria-hidden="true">
          {head}
        </p>
      )}
      {items.map((item) => (
        <MenuEntry
          key={item.testId}
          item={item}
          testId={`${testId}-${item.testId}`}
          disabled={!connected}
          onClose={onClose}
        />
      ))}
    </div>
  )
}

function MenuEntry({
  item,
  testId,
  disabled,
  onClose
}: {
  item: MenuItem
  testId: string
  disabled: boolean
  onClose: () => void
}): React.JSX.Element {
  return (
    <>
      {item.separated && <hr className="menu-rule" />}
      <button
        type="button"
        {...itemRole(item)}
        title={item.title}
        data-testid={testId}
        data-ref={item.dataRef}
        disabled={disabled}
        onClick={() => {
          onClose()
          item.action()
        }}
      >
        {item.checked !== undefined && (
          <span className="menu-check" aria-hidden="true">
            {item.checked ? '✓' : ''}
          </span>
        )}
        {item.hint === undefined ? (
          item.label
        ) : (
          <>
            <span>{item.label}</span> <span className="menu-hint">{item.hint}</span>
          </>
        )}
      </button>
    </>
  )
}
