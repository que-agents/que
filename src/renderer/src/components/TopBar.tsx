import { SCRATCH, useQue, useStore } from '../store'
import { StatusBadge } from './StatusBadge'
import UnlockStatus from './UnlockStatus'

/** The selected workspace (or the loose terminals) and its actions. */
export default function TopBar({ termKey }: { termKey: string }): React.JSX.Element {
  const store = useStore()
  const { workspaces, projects, connected } = useQue()
  const ws = termKey === SCRATCH ? undefined : workspaces[termKey]
  const project = ws ? projects.find((p) => p.id === ws.projectId) : undefined
  const cwd = store.activeTab(termKey)?.cwd ?? ws?.path ?? ''

  return (
    <header className="topbar" data-testid="topbar">
      {ws ? (
        <>
          {project && (
            <>
              <span className="crumb" data-testid="topbar-project">
                {project.name}
              </span>
              <span className="crumb-sep" aria-hidden="true">
                /
              </span>
            </>
          )}
          <h1 className="title" title={ws.path} data-testid="topbar-title">
            {ws.name}
          </h1>
          {ws.branch !== ws.name && (
            <span className="branch" data-testid="topbar-branch">
              {ws.branch}
            </span>
          )}
          <StatusBadge status={ws.status} reason={ws.statusReason} testId="topbar-status" />
          {ws.prUrl && (
            <a href={ws.prUrl} target="_blank" rel="noreferrer" data-testid="topbar-pr">
              PR #{ws.prUrl.split('/').pop()}
            </a>
          )}
        </>
      ) : (
        <h1 className="title" data-testid="topbar-title">
          Sessions
        </h1>
      )}
      <span className="cwd" title={cwd} data-testid="topbar-cwd">
        {cwd}
      </span>
      <UnlockStatus />
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
        </div>
      )}
    </header>
  )
}
