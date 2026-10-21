import type { ComponentPropsWithoutRef } from 'react'

/**
 * The working mark: four accent dots on a 2×2 grid with a diagonal ripple, CSS only
 * (`.working-mark` in styles.css). The sidebar and the quiet board draw it in place of a
 * status dot while something works. Any other props land on the span.
 */
export default function WorkingMark(
  props: Omit<ComponentPropsWithoutRef<'span'>, 'className' | 'children'>
): React.JSX.Element {
  return (
    <span className="working-mark" {...props}>
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}
