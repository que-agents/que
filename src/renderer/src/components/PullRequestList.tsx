import type { PullRequest, Workspace } from '../../../preload/index.d'
import { checksLine } from '../format'
import { baseLabel, fromSubagent, hasNewComments, orderPrs, prCounts } from '../pr-list'
import { useQueSelector, useStore } from '../store'
import { CommentIcon } from './icons'
import { LineCounts, PrDotMark } from './ReviewParts'

function Row({
  ws,
  pr,
  settled
}: {
  ws: Workspace
  pr: PullRequest
  settled: boolean
}): React.JSX.Element {
  const store = useStore()
  const seenAt = useQueSelector((s) => s.review.seen[ws.id]?.[pr.number])
  const fresh = hasNewComments(pr, seenAt)
  const checks = checksLine(pr)
  const id = `pr-row-${pr.number}`

  return (
    <li>
      <button
        type="button"
        className={`pr-row${settled ? ' settled' : ''}`}
        data-testid={id}
        data-state={pr.state}
        title={pr.title}
        onClick={() => store.openPullRequest(ws.id, pr.number)}
      >
        <PrDotMark pr={pr} />
        <span className="pr-row-title">
          <span className="pr-row-number">#{pr.number}</span>
          <span className="pr-row-name">{pr.title}</span>
        </span>
        <span
          className={`pr-row-comments${fresh ? ' new' : ''}`}
          data-testid={`${id}-comments`}
          data-new={fresh}
          title={fresh ? 'New comments since you last opened it' : undefined}
        >
          {pr.comments !== null && pr.comments > 0 && (
            <>
              <CommentIcon />
              {pr.comments}
            </>
          )}
        </span>
        <span className="pr-row-meta" data-testid={`${id}-meta`}>
          <span>into {baseLabel(pr, ws.prs)}</span>
          {checks ? (
            <span className={`tone-${checks.tone}`} data-testid={`${id}-checks`}>
              {checks.text}
            </span>
          ) : (
            pr.state !== 'open' && <span>{pr.state}</span>
          )}
          {pr.additions !== null && pr.deletions !== null && (
            <span>
              <LineCounts adds={pr.additions} dels={pr.deletions} />
            </span>
          )}
          {fromSubagent(pr, ws.branches) && <span data-testid={`${id}-subagent`}>· subagent</span>}
        </span>
      </button>
    </li>
  )
}

/** Why the last check of the session's pull requests with GitHub failed, while it stands. */
function CheckError({ error }: { error: string | undefined }): React.JSX.Element | null {
  if (!error) return null

  return (
    <p className="form-error changes-error" role="alert" data-testid="prs-check-error">
      {error}
    </p>
  )
}

/**
 * The session's pull requests, in the review pane: open and draft first, newest first, then
 * the merged and closed ones under a dashed rule. A row opens its pull request in place.
 */
export default function PullRequestList({ termKey }: { termKey: string }): React.JSX.Element {
  const ws = useQueSelector((s) => s.workspaces[termKey])
  const checkError = useQueSelector((s) => s.prCheckErrors[termKey])
  const prs = ws?.prs ?? []
  const { active, settled } = orderPrs(prs)
  const { open, failing } = prCounts(prs)

  if (!ws || prs.length === 0) {
    return (
      <section className="pr-list" data-testid="pr-list" aria-label="Pull requests">
        <CheckError error={checkError} />
        <p className="review-empty-note" data-testid="pr-empty">
          No pull requests from this session yet.
        </p>
      </section>
    )
  }

  return (
    <section className="pr-list" data-testid="pr-list" aria-label="Pull requests">
      <header className="review-head">
        <h2 className="label">[ Pull requests ]</h2>
        <span className="review-sum" data-testid="pr-list-summary">
          {open} open
          {failing > 0 && (
            <>
              {' · '}
              <span className="tone-bad">{failing} failing</span>
            </>
          )}
        </span>
      </header>
      <CheckError error={checkError} />
      <ul className="pr-rows" data-testid="pr-rows-active">
        {active.map((pr) => (
          <Row key={pr.number} ws={ws} pr={pr} settled={false} />
        ))}
      </ul>
      {settled.length > 0 && (
        <>
          <hr className="review-rule" />
          <p className="label review-group" data-testid="pr-settled-label">
            [ merged · closed ]
          </p>
          <ul className="pr-rows" data-testid="pr-rows-settled">
            {settled.map((pr) => (
              <Row key={pr.number} ws={ws} pr={pr} settled />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
