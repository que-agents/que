import type { Terminal } from '@xterm/xterm'

// Registry of the xterm currently on screen, read by the e2e test hook.
let active: { id: string; term: Terminal } | null = null

export function setActiveTerminal(id: string, term: Terminal): void {
  active = { id, term }
}

export function clearActiveTerminal(term: Terminal): void {
  if (active?.term === term) active = null
}

/** Installs window.__que, only when the app was launched with QUE_E2E=1. */
export function installTestHook(): void {
  if (window.que.app.e2e !== true) return
  window.__que = {
    activeTermId: () => active?.id ?? null,
    screenText: () => {
      if (!active) return ''
      const buf = active.term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buf.length; i++) {
        lines.push(buf.getLine(i)?.translateToString(true) ?? '')
      }
      return lines.join('\n')
    }
  }
}
