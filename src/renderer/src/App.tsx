import { useCallback, useEffect, useRef, useState } from 'react'
import Terminal from './components/Terminal'
import type { TermInfo } from '../../preload/index.d'

interface Tab {
  id: string
  name: string
  cwd: string
  alive: boolean
  /** Was already running in the daemon when this app instance launched. */
  reattached: boolean
}

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

function toTab(t: TermInfo, reattached: boolean): Tab {
  return { id: t.id, name: t.name, cwd: t.cwd, alive: t.alive, reattached }
}

// Guards against StrictMode running the startup effect twice and creating two
// terminals on a fresh launch.
let startup: Promise<{ tabs: Tab[]; active: string | null }> | null = null

async function loadInitial(): Promise<{ tabs: Tab[]; active: string | null }> {
  const existing = (await window.que.term.list())
    .filter((t) => t.alive)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  if (existing.length > 0) {
    const tabs = existing.map((t) => toTab(t, true))
    return { tabs, active: tabs[tabs.length - 1].id }
  }
  const cwd = await window.que.app.homedir()
  const { id } = await window.que.term.create({ cwd, cols: DEFAULT_COLS, rows: DEFAULT_ROWS })
  const info = (await window.que.term.list()).find((t) => t.id === id)
  const tab: Tab = info ? toTab(info, false) : { id, name: 'shell', cwd, alive: true, reattached: false }
  return { tabs: [tab], active: id }
}

export default function App(): React.JSX.Element {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  useEffect(() => {
    startup ??= loadInitial()
    startup.then(
      ({ tabs, active }) => {
        setTabs(tabs)
        setActiveId(active)
      },
      (err: Error) => setError(err.message)
    )
  }, [])

  // Keep tabs in sync with terminals created, killed or exited elsewhere (CLI).
  useEffect(() => {
    const offs = [
      window.que.term.on('term.created', ({ id }) => {
        void window.que.term.list().then((list) => {
          const info = list.find((t) => t.id === id)
          if (!info) return
          setTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, toTab(info, false)]))
        })
      }),
      window.que.term.on('term.killed', ({ id }) => {
        setTabs((prev) => prev.filter((t) => t.id !== id))
      }),
      window.que.term.on('term.exit', ({ id }) => {
        setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, alive: false } : t)))
      }),
      window.que.term.onDisconnect(() => setError('Lost connection to the que daemon.'))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // If the active tab disappears, fall back to the last remaining one.
  useEffect(() => {
    if (activeId && !tabs.some((t) => t.id === activeId)) {
      setActiveId(tabs.length > 0 ? tabs[tabs.length - 1].id : null)
    }
  }, [tabs, activeId])

  const createIn = useCallback(async (cwd: string) => {
    try {
      const { id } = await window.que.term.create({ cwd, cols: DEFAULT_COLS, rows: DEFAULT_ROWS })
      const info = (await window.que.term.list()).find((t) => t.id === id)
      setTabs((prev) =>
        prev.some((t) => t.id === id)
          ? prev
          : [...prev, info ? toTab(info, false) : { id, name: 'shell', cwd, alive: true, reattached: false }]
      )
      setActiveId(id)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const active = tabs.find((t) => t.id === activeId) ?? null

  async function newTerminal(): Promise<void> {
    await createIn(active?.cwd ?? (await window.que.app.homedir()))
  }

  async function openFolder(): Promise<void> {
    const dir = await window.que.app.openFolder()
    if (dir) await createIn(dir)
  }

  async function closeTab(id: string): Promise<void> {
    setTabs((prev) => prev.filter((t) => t.id !== id))
    try {
      await window.que.term.kill({ id })
    } catch {
      // Already gone.
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <span key={t.id} className={`tab${t.id === activeId ? ' active' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={t.id === activeId}
                data-term-id={t.id}
                title={t.cwd}
                onClick={() => setActiveId(t.id)}
              >
                {t.name} <span className="short-id">{t.id.slice(0, 6)}</span>
                {!t.alive && <span className="badge exited">exited</span>}
                {t.reattached && <span className="badge">reattached</span>}
              </button>
              <button
                type="button"
                className="close"
                aria-label={`Close ${t.name}`}
                onClick={() => void closeTab(t.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <span className="cwd" title={active?.cwd ?? ''}>
          {active?.cwd ?? ''}
        </span>
        <button type="button" onClick={() => void newTerminal()}>
          New terminal
        </button>
        <button type="button" onClick={() => void openFolder()}>
          Open folder…
        </button>
      </header>
      {error && <div className="error">{error}</div>}
      {active ? (
        <Terminal key={active.id} id={active.id} />
      ) : (
        <div className="empty">{tabs.length === 0 && !error ? 'No terminals.' : ''}</div>
      )}
    </div>
  )
}
