import { useEffect, useRef } from 'react'

/**
 * Closes a floating surface (a menu, a card): on Escape, and on a press anywhere outside the
 * elements in `inside`. A press inside one of them is left to that element.
 */
export function useDismiss(
  onClose: () => void,
  ...inside: ReadonlyArray<React.RefObject<Element | null>>
): void {
  const refs = useRef(inside)

  useEffect(() => {
    refs.current = inside
  })

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node

      if (refs.current.some((r) => r.current?.contains(target))) return
      onClose()
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
}
