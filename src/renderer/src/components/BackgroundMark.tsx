import type { ComponentPropsWithoutRef } from 'react'

/**
 * The background mark, `›_` (the session glyph): an idle workspace whose session still has
 * a shell or monitor running. The sidebar draws it at the row's right end, the quiet board
 * after the state word. Hidden from assistive tech; any other props land on the span.
 */
export default function BackgroundMark(
  props: Omit<ComponentPropsWithoutRef<'span'>, 'className' | 'children' | 'aria-hidden'>
): React.JSX.Element {
  return (
    <span className="bg-mark" aria-hidden="true" {...props}>
      ›_
    </span>
  )
}
