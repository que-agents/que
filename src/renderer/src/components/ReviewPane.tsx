import { useEffect, useState } from 'react'
import { prCounts } from '../pr-list'
import { type ReviewView, SCRATCH, useQueSelector, useStore } from '../store'
import ChangesList from './ChangesList'
import FilesTree from './FilesTree'
import { ChangesIcon, EditorIcon, FolderIcon, PullRequestIcon, RefreshIcon } from './icons'
import PullRequestDetail from './PullRequestDetail'
import PullRequestList from './PullRequestList'

const VIEWS: ReadonlyArray<{ view: ReviewView; name: string; Icon: () => React.JSX.Element }> = [
  { view: 'prs', name: 'Pull requests', Icon: PullRequestIcon },
  { view: 'changes', name: 'Changes', Icon: ChangesIcon },
  { view: 'files', name: 'Files', Icon: FolderIcon }
]

/**
 * The review pane at the right of the main area. Three icons in its strip pick the view: the
 * session's pull requests, the worktree's changes, or the project's files; a pull request opens
 * in place, and the strip's left end becomes its back link. The view's own buttons sit at the
 * strip's right end. The pane remembers its view per workspace.
 */
export default function ReviewPane({ termKey }: { termKey: string }): React.JSX.Element {
  const store = useStore()
  const connected = useQueSelector((s) => s.connected)
  const ws = useQueSelector((s) => s.workspaces[termKey])
  const changed = useQueSelector((s) => s.diffs[termKey]?.data?.files.length)
  // Read for the re-render; the place itself comes from the store's rule.
  useQueSelector((s) => s.review)
  const place = store.reviewPlace(termKey)
  const [filterFocus, setFilterFocus] = useState(0)
  const workspace = termKey !== SCRATCH

  const pr =
    place.view === 'prs' && place.pr !== null
      ? ws?.prs.find((p) => p.number === place.pr)
      : undefined

  const numbers = ws?.prs.map((p) => p.number).join(',')

  // Whatever the view shows, unless it is loaded or on its way.
  useEffect(() => {
    store.ensureReview(termKey)
  }, [store, termKey, place.view, place.pr, numbers])

  const counts: Record<ReviewView, number | undefined> = {
    prs: ws ? prCounts(ws.prs).open : undefined,
    changes: changed,
    files: undefined
  }

  const refresh = (): void => {
    if (place.view === 'changes') void store.fetchDiff(termKey)
    else if (place.view === 'files') void store.refreshFiles(termKey)
    else void store.refreshPrs(termKey)
  }

  // ⌘F while the pane has focus: the Files view's filter.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!workspace || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return

    if (e.key.toLowerCase() !== 'f') return
    e.preventDefault()

    if (place.view !== 'files') store.setReviewView(termKey, 'files')
    setFilterFocus((n) => n + 1)
  }

  const testId = place.view === 'prs' ? 'pr' : place.view

  return (
    <aside
      className="review"
      data-testid="review-pane"
      data-view={place.view}
      data-pr={pr?.number}
      aria-label="Review"
      onKeyDown={onKeyDown}
    >
      <div className="review-bar" data-testid="review-bar">
        {pr ? (
          <button
            type="button"
            className="ghost review-back"
            aria-label="Back to pull requests"
            title="Back to pull requests"
            data-testid="review-back"
            onClick={() => store.closePullRequest(termKey)}
          >
            ‹ <span className="review-back-number">#{pr.number}</span>
          </button>
        ) : (
          <div className="review-views" role="tablist" aria-label="Review">
            {VIEWS.map(({ view, name, Icon }) => {
              const current = place.view === view

              return (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  className={`ghost icon review-view${current ? ' active' : ''}`}
                  aria-label={name}
                  title={name}
                  aria-selected={current}
                  data-testid={`review-view-${view}`}
                  onClick={() => store.setReviewView(termKey, view)}
                >
                  <Icon />
                  {workspace && counts[view] !== undefined && (
                    <span className="review-view-count" data-testid={`review-view-${view}-count`}>
                      {counts[view]}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
        {workspace && (
          <div className="review-actions">
            {/* The list has nothing of its own to fetch: the daemon keeps it fresh. */}
            {!(place.view === 'prs' && !pr) && (
              <button
                type="button"
                className="ghost icon"
                aria-label="Refresh"
                title="Refresh"
                data-testid={`${testId}-refresh`}
                disabled={!connected}
                onClick={refresh}
              >
                <RefreshIcon />
              </button>
            )}
            {ws && (
              <button
                type="button"
                className="ghost icon"
                aria-label="Open in editor"
                title="Open in editor"
                data-testid={`${testId}-open-editor`}
                disabled={!connected}
                onClick={() => void store.openInEditor(ws.path)}
              >
                <EditorIcon />
              </button>
            )}
          </div>
        )}
      </div>
      {!workspace ? (
        <p className="changes-note" data-testid="review-empty">
          No workspace
        </p>
      ) : place.view === 'changes' ? (
        <ChangesList termKey={termKey} />
      ) : place.view === 'files' ? (
        <FilesTree termKey={termKey} focusFilter={filterFocus} />
      ) : pr ? (
        <PullRequestDetail key={pr.number} termKey={termKey} number={pr.number} />
      ) : (
        <PullRequestList termKey={termKey} />
      )}
    </aside>
  )
}
