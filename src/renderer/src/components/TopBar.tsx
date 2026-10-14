import { SCRATCH, useQue, useStore } from '../store'
import { StatusBadge } from './StatusBadge'

/** The selected workspace (or the loose terminals) and its actions. */
export default function TopBar({ termKey }: { termKey: string }): React.JSX.Element {
  const store = useStore()
  const { workspaces, connected } = useQue()
  const ws = termKey === SCRATCH ? undefined : workspaces[termKey]
  const cwd = store.activeTab(termKey)?.cwd ?? ws?.path ?? ''

  return (
    <header className="topbar" data-testid="topbar">
      {ws ? (
        <>
          <h1 className="title" title={ws.path} data-testid="topbar-title">
            {ws.name}
          </h1>
          <span className="branch" data-testid="topbar-branch">
            {ws.branch}
          </span>
          <StatusBadge status={ws.status} reason={ws.statusReason} testId="topbar-status" />
          {ws.prUrl && (
            <a href={ws.prUrl} target="_blank" rel="noreferrer" data-testid="topbar-pr">
              PR #{ws.prUrl.split('/').pop()}
            </a>
          )}
        </>
      ) : (
        <h1 className="title" data-testid="topbar-title">
          Terminals
        </h1>
      )}
      <span className="cwd" title={cwd} data-testid="topbar-cwd">
        {cwd}
      </span>
      {ws && (
        <div className="actions">
          <button
            type="button"
            data-testid="topbar-open-editor"
            disabled={!connected}
            onClick={() => void store.openInEditor(ws.path)}
          >
            Open in editor
          </button>
          <button
            type="button"
            data-testid="topbar-create-pr"
            disabled={!connected}
            onClick={() => store.openDialog({ kind: 'create-pr', workspaceId: ws.id })}
          >
            Create draft PR
          </button>
          <button
            type="button"
            data-testid="topbar-handoff"
            disabled={!connected}
            onClick={() => store.openDialog({ kind: 'handoff', workspaceId: ws.id })}
          >
            Hand off…
          </button>
        </div>
      )}
    </header>
  )
}
