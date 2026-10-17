import { COUNT_SEPARATOR, type CountItem, countItemText } from '../../../shared/count-line'

/** One count line item as a span: a toned or muted word, else faint. */
function CountSpan({ item }: { item: CountItem }): React.JSX.Element {
  const text = countItemText(item)

  if (!item.tone) return <span>{text}</span>

  return <span className={item.tone === 'muted' ? 'muted' : `tone-${item.tone}`}>{text}</span>
}

/**
 * A `.count-line`: the items in one faint mono line, each with its own tone,
 * or `children` when there are none (`nothing running`).
 */
export default function CountLine({
  items,
  testId,
  children
}: {
  items: readonly CountItem[]
  testId?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <p className="count-line" data-testid={testId}>
      {items.length === 0
        ? children
        : items.map((item, i) => (
            <span key={item.label}>
              {i > 0 ? COUNT_SEPARATOR : ''}
              <CountSpan item={item} />
            </span>
          ))}
    </p>
  )
}
