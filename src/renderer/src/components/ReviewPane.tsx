import { type ReviewTab, SCRATCH, useQue, useStore } from '../store'
import ChangesList from './ChangesList'
import FilesTree from './FilesTree'
import { CloseIcon } from './icons'
import PullRequestView from './PullRequestView'

const TABS: ReadonlyArray<{ tab: ReviewTab; label: string }> = [
  { tab: 'changes', label: 'Changes' },
  { tab: 'files', label: 'Files' },
  { tab: 'pr', label: 'Pull request' }
]

/** The review pane at the right of the main area: the workspace's changes, its files, or its pull request. */
export default function ReviewPane({ termKey }: { termKey: string }): React.JSX.Element {
  const store = useStore()
  const { review } = useQue()

  return (
    <aside className="review" data-testid="review-pane" data-tab={review.tab} aria-label="Review">
      <div className="review-bar">
        <div className="review-tabs" role="tablist" aria-label="Review">
          {TABS.map(({ tab, label }) => (
            <button
              key={tab}
              type="button"
              role="tab"
              className={`review-tab${review.tab === tab ? ' active' : ''}`}
              aria-selected={review.tab === tab}
              data-active={review.tab === tab}
              data-testid={`review-tab-${tab}`}
              onClick={() => store.setReviewTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ghost icon"
          aria-label="Close review"
          title="Close review"
          data-testid="review-close"
          onClick={() => store.closeReview()}
        >
          <CloseIcon />
        </button>
      </div>
      {termKey === SCRATCH ? (
        <p className="changes-note" data-testid="review-empty">
          No workspace
        </p>
      ) : review.tab === 'changes' ? (
        <ChangesList termKey={termKey} />
      ) : review.tab === 'files' ? (
        <FilesTree termKey={termKey} />
      ) : (
        <PullRequestView termKey={termKey} />
      )}
    </aside>
  )
}
