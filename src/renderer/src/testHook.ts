import type { Terminal } from '@xterm/xterm'

export interface PaneInfo {
  index: number
  activeTermId: string | null
  focused: boolean
}

// Registry of the xterms currently on screen, by terminal id, read by the e2e test hook.
const mounted = new Map<string, Terminal>()
// Where the panes are, supplied by <Panes> while it is on screen.
let paneSource: (() => PaneInfo[]) | null = null

export function setActiveTerminal(id: string, term: Terminal): void {
  mounted.set(id, term)
}

export function clearActiveTerminal(term: Terminal): void {
  for (const [id, t] of mounted) if (t === term) mounted.delete(id)
}

export function setPaneSource(source: (() => PaneInfo[]) | null): void {
  paneSource = source
}

function textOf(term: Terminal): string {
  const buf = term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buf.length; i++) {
    lines.push(buf.getLine(i)?.translateToString(true) ?? '')
  }
  return lines.join('\n')
}

/** Installs window.__que, only when the app was launched with QUE_E2E=1. */
export function installTestHook(): void {
  if (window.que.app.e2e !== true) return
  const screenTextOf = (termId: string): string => {
    const term = mounted.get(termId)
    return term ? textOf(term) : ''
  }
  // The focused pane's terminal, once it is attached.
  const activeTermId = (): string | null => {
    const focused = paneSource?.().find((p) => p.focused)
    return focused?.activeTermId && mounted.has(focused.activeTermId) ? focused.activeTermId : null
  }
  window.__que = {
    activeTermId,
    screenText: () => {
      const id = activeTermId()
      return id ? screenTextOf(id) : ''
    },
    panes: () => paneSource?.() ?? [],
    screenTextOf,
    trayTitle: () => window.que.app.trayTitle()
  }
}
