import { SCRATCH, useQue, useStore, viewId } from '../store'
import { JoinPanesIcon, SplitBelowIcon, SplitBesideIcon } from './icons'
import { PrChip, StatusBadge } from './StatusBadge'
import UnlockStatus from './UnlockStatus'

/** The selected workspace (or the loose terminals) and its actions. */
export default function TopBar({ termKey }: { termKey: string }): React.JSX.Element {
  const store = useStore()
  const { workspaces, projects, connected } = useQue()
  const ws = termKey === SCRATCH ? undefined : workspaces[termKey]
  const project = ws ? projects.find((p) => p.id === ws.projectId) : undefined
  const split = Boolean(store.layout(termKey).split)
  const focusedTab = store.paneActiveId(termKey, store.focusedPane(termKey))
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
          {ws.pr ? (
            <PrChip
              pr={ws.pr}
              testId="topbar-pr"
              // Number and state only; checks and review are the tone, and the tooltip spells them out.
              label={`PR #${ws.pr.number} · ${ws.pr.state}`}
            />
          ) : (
            ws.prUrl && (
              <a href={ws.prUrl} target="_blank" rel="noreferrer" data-testid="topbar-pr">
                PR #{ws.prUrl.split('/').pop()}
              </a>
            )
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
      <div className="actions">
        {split ? (
          <button
            type="button"
            className="ghost icon"
            aria-label="Join panes"
            title="Join panes: the second pane's tabs move to the first"
            data-testid="topbar-join"
            disabled={!connected}
            onClick={() => store.joinPanes(termKey)}
          >
            <JoinPanesIcon />
          </button>
        ) : (
          <>
            <button
              type="button"
              className="ghost icon"
              aria-label="Split beside"
              title="Split beside (⌘D)"
              data-testid="topbar-split-beside"
              disabled={!connected}
              onClick={() => void store.splitPane(termKey, 'row')}
            >
              <SplitBesideIcon />
            </button>
            <button
              type="button"
              className="ghost icon"
              aria-label="Split below"
              title="Split below (⌘⇧D)"
              data-testid="topbar-split-below"
              disabled={!connected}
              onClick={() => void store.splitPane(termKey, 'column')}
            >
              <SplitBelowIcon />
            </button>
          </>
        )}
        {ws && (
          <>
            <button
              type="button"
              aria-pressed={focusedTab === viewId('changes')}
              title="Changes: the changed files and their diffs, as a tab"
              data-testid="topbar-changes"
              disabled={!connected}
              onClick={() => store.toggleView(termKey, 'changes')}
            >
              Changes
            </button>
            <button
              type="button"
              aria-pressed={focusedTab === viewId('pr')}
              title="Pull request: its checks and conversation, as a tab"
              data-testid="topbar-pull-request"
              data-pr-state={ws.pr?.state ?? 'none'}
              disabled={!connected}
              onClick={() => store.toggleView(termKey, 'pr')}
            >
              Pull request
            </button>
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
          </>
        )}
      </div>
    </header>
  )
}
