import { useEffect, useState } from 'react'
import {
  AddTaskDialog,
  CreatePrDialog,
  HandoffDialog,
  NewWorkspaceDialog,
  RemoveWorkspaceDialog
} from './components/dialogs'
import ReportView from './components/ReportView'
import Sidebar from './components/Sidebar'
import TerminalTabs from './components/TerminalTabs'
import TopBar from './components/TopBar'
import { QueStore, StoreContext, useQue, useStore } from './store'

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

function Shell(): React.JSX.Element {
  const store = useStore()
  const { view, error, dialog, connected } = useQue()
  const termKey = view.kind === 'terminals' ? view.key : null

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
        {termKey !== null ? (
          <>
            <TopBar termKey={termKey} />
            <TerminalTabs termKey={termKey} />
          </>
        ) : (
          <ReportView />
        )}
      </main>
      <Dialogs />
    </div>
  )
}

export default function App(): React.JSX.Element {
  const [store] = useState(() => new QueStore(window.que))

  useEffect(() => {
    store.start()
    return () => store.stop()
  }, [store])

  return (
    <StoreContext.Provider value={store}>
      <Shell />
    </StoreContext.Provider>
  )
}
