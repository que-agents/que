import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'

interface Props {
  cwd: string
}

const isMac = navigator.userAgent.includes('Mac')

export default function Terminal({ cwd }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new XTerm({
      fontFamily: 'Menlo, "SF Mono", "JetBrains Mono", Monaco, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10000,
      macOptionIsMeta: false,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)

    // Prefer the GPU renderer; fall back to xterm's default DOM renderer if
    // WebGL is unavailable or the context is lost later.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch (err) {
      console.warn('WebGL renderer unavailable, using default renderer', err)
    }

    // Cmd+C copies when there is a selection. Cmd+V goes through the default
    // Edit menu's paste role into xterm's textarea, which applies bracketed
    // paste when the running program has enabled it.
    term.attachCustomKeyEventHandler((ev) => {
      if (!isMac || ev.type !== 'keydown' || !ev.metaKey) return true
      if (ev.key.toLowerCase() === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        ev.preventDefault()
        return false
      }
      return true
    })

    fit.fit()
    term.focus()

    let id: string | null = null
    let disposed = false
    const cleanups: Array<() => void> = []

    void window.que.pty.spawn({ cwd, cols: term.cols, rows: term.rows }).then((res) => {
      if (disposed) {
        window.que.pty.kill(res.id)
        return
      }
      id = res.id
      cleanups.push(window.que.pty.onData(res.id, (data) => term.write(data)))
      cleanups.push(
        window.que.pty.onExit(res.id, ({ exitCode }) => {
          term.write(`\r\n[process exited with code ${exitCode}]\r\n`)
        })
      )
      const input = term.onData((data) => window.que.pty.write(res.id, data))
      cleanups.push(() => input.dispose())
      // Sync in case the window resized while the spawn was in flight.
      window.que.pty.resize(res.id, term.cols, term.rows)
    })

    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        fit.fit()
        if (id) window.que.pty.resize(id, term.cols, term.rows)
      })
    })
    observer.observe(host)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      for (const c of cleanups) c()
      if (id) window.que.pty.kill(id)
      term.dispose()
    }
  }, [cwd])

  return <div className="terminal" ref={hostRef} />
}
