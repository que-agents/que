import { useEffect, useState } from 'react'
import {
  AddTaskDialog,
  CreatePrDialog,
  HandoffDialog,
  NewWorkspaceDialog,
  RemoveWorkspaceDialog
} from './components/dialogs'
import { hhmm } from '../../daemon/quiet-hours'
import QuietBoard from './components/QuietBoard'
import ReportView from './components/ReportView'
import SettingsView from './components/SettingsView'
import Sidebar from './components/Sidebar'
import TerminalTabs from './components/TerminalTabs'
import TopBar from './components/TopBar'
import UpdateBanner from './components/UpdateBanner'
import { isLocked, QueStore, StoreContext, useQue, useStore } from './store'

function Dialogs(): React.JSX.Element | null {
  const store = useStore()
  const { dialog, projects, workspaces } = useQue()
  const close = (): void => store.closeDialog()
  if (!dialog) return null
  switch (dialog.kind) {
    case 'new-workspace': {
      const project = projects.find((p) => p.id === dialog.projectId)
      return project ? <NewWorkspaceDialog project={project} onClose={close} /> : null
    }
    case 'add-task':
      return <AddTaskDialog onClose={close} />
    default: {
      const ws = workspaces[dialog.workspaceId]
      if (!ws) return null
      if (dialog.kind === 'handoff') return <HandoffDialog workspace={ws} onClose={close} />
      if (dialog.kind === 'create-pr') return <CreatePrDialog workspace={ws} onClose={close} />
      return <RemoveWorkspaceDialog workspace={ws} onClose={close} />
    }
  }
}

/** What the (hidden) main window shows while quiet hours are locked: no detail at all. */
function Locked(): React.JSX.Element {
  const { quiet } = useQue()
  return (
    <section className="locked" data-testid="quiet-locked" aria-label="Quiet hours">
      <p>
        Quiet hours. Detail unlocks at{' '}
        {quiet?.windowEnd ? hhmm(Date.parse(quiet.windowEnd)) : '--:--'}.
      </p>
    </section>
  )
}

function Shell(): React.JSX.Element {
  const store = useStore()
  const { view, error, dialog, connected, quiet } = useQue()
  const locked = isLocked(quiet)
  const termKey = view.kind === 'terminals' && !locked ? view.key : null

  // Cmd+T / Cmd+W manage the terminal tabs; captured before xterm sees them.
  useEffect(() => {
    if (termKey === null || dialog) return
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return
      const key = e.key.toLowerCase()
      if (key !== 't' && key !== 'w') return
      e.preventDefault()
      e.stopPropagation()
      if (key === 't') void store.newTerminal(termKey)
      else {
        const active = store.activeTab(termKey)
        if (active) void store.closeTerminal(active.id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [store, termKey, dialog])

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <UpdateBanner />
        {!connected ? (
          <div className="error" role="alert" data-testid="app-error">
            <span>Lost connection to the que daemon.</span>
          </div>
        ) : (
          error && (
            <div className="error" role="alert" data-testid="app-error">
              <span>{error}</span>
              <button
                type="button"
                className="ghost"
                aria-label="Dismiss"
                onClick={() => store.dismissError()}
              >
                ×
              </button>
            </div>
          )
        )}
        {locked ? (
          <Locked />
        ) : termKey !== null ? (
          <>
            <TopBar termKey={termKey} />
            <TerminalTabs termKey={termKey} />
          </>
        ) : view.kind === 'settings' ? (
          <SettingsView />
        ) : (
          <ReportView />
        )}
      </main>
      <Dialogs />
    </div>
  )
}

/** The board window loads the renderer with `#board`. */
function isBoardWindow(): boolean {
  return window.location.hash === '#board'
}

export default function App({
  board = isBoardWindow(),
  now
}: {
  /** Render the quiet board (its own window) instead of the app. */
  board?: boolean
  /** The clock (tests pass a fixed one). Default Date.now. */
  now?: () => number
}): React.JSX.Element {
  const [store] = useState(() => new QueStore(window.que, { board, now }))

  useEffect(() => {
    store.start()
    return () => store.stop()
  }, [store])

  return (
    <StoreContext.Provider value={store}>
      {board ? <QuietBoard /> : <Shell />}
    </StoreContext.Provider>
  )
}
