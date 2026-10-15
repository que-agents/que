import { SCRATCH, useQue, useStore } from '../store'
import { JoinPanesIcon, PanelRightIcon, SplitBelowIcon, SplitBesideIcon } from './icons'
import { PrChip, StatusBadge } from './StatusBadge'
import UnlockStatus from './UnlockStatus'

/** The selected workspace (or the loose terminals) and its actions. */
export default function TopBar({ termKey }: { termKey: string }): React.JSX.Element {
  const store = useStore()
  const { workspaces, projects, connected, review } = useQue()
  const ws = termKey === SCRATCH ? undefined : workspaces[termKey]
  const project = ws ? projects.find((p) => p.id === ws.projectId) : undefined
  const split = Boolean(store.layout(termKey).split)
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
          <button
            type="button"
            className="ghost icon"
            aria-label="Review pane"
            aria-pressed={review.open}
            title="Review pane: changes and pull request (⌘B)"
            data-testid="topbar-review"
            disabled={!connected}
            onClick={() => store.toggleReview()}
          >
            <PanelRightIcon filled={review.open} />
          </button>
        )}
      </div>
    </header>
  )
}
