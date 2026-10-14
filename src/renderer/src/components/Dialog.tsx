import { type ReactNode, useEffect, useId, useRef } from 'react'

interface Props {
  title: string
  testId: string
  onClose: () => void
  children: ReactNode
}

/**
 * A modal dialog: labelled by its title, focus moves to its first field on
 * open and back to whatever had it on close, Escape closes it.
 */
export default function Dialog({ title, testId, onClose, children }: Props): React.JSX.Element {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>(
      'input:not([type=hidden]), textarea, select, button'
    )
    first?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [])

  return (
    <div className="dialog-backdrop">
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  )
}
