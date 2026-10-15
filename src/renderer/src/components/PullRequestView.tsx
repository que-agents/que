import { useEffect } from 'react'
import type { PrCheck, PrThreadEntry, PullRequest, ReviewState } from '../../../preload/index.d'
import { formatAge, formatDuration, type Tone } from '../format'
import { splitFences } from '../pr-text'
import { useQue, useStore } from '../store'
import { ExternalLinkIcon } from './icons'

const CHECK_TONE: Record<PrCheck['state'], Tone> = {
  passing: 'good',
  failing: 'bad',
  pending: 'busy',
  skipped: 'muted'
}

const SUMMARY_ORDER: ReadonlyArray<PrCheck['state']> = ['passing', 'failing', 'pending', 'skipped']

const DECISION: Record<NonNullable<PullRequest['review']>, { label: string; tone: Tone }> = {
  approved: { label: 'approved', tone: 'good' },
  changes_requested: { label: 'changes requested', tone: 'bad' },
  review_required: { label: 'review required', tone: 'attention' }
}

const REVIEW: Record<ReviewState, { label: string; tone: Tone }> = {
  approved: { label: 'approved', tone: 'good' },
  changes_requested: { label: 'changes requested', tone: 'bad' },
  commented: { label: 'commented', tone: 'neutral' },
  dismissed: { label: 'dismissed', tone: 'muted' },
  pending: { label: 'pending', tone: 'attention' }
}

/** `3 passing · 1 failing`: the count per state, in a fixed order, zeros left out. */
function checksSummary(checks: readonly PrCheck[]): string {
  return SUMMARY_ORDER.map((state) => [state, checks.filter((c) => c.state === state).length])
    .filter(([, n]) => n !== 0)
    .map(([state, n]) => `${n} ${state}`)
    .join(' · ')
}

/** A comment body: text with its line breaks, fenced blocks in mono. */
function Body({ body }: { body: string }): React.JSX.Element {
  return (
    <div className="pr-comment-body">
      {splitFences(body).map((part, i) =>
        part.kind === 'code' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one body are static
          <pre key={i} className="pr-code" data-lang={part.lang || undefined}>
            {part.text}
          </pre>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one body are static
          <p key={i} className="pr-text">
            {part.text}
          </p>
        )
      )}
    </div>
  )
}

function Comment({
  entry,
  index,
  now
}: {
  entry: PrThreadEntry
  index: number
  now: number
}): React.JSX.Element {
  const id = `pr-comment-${index}`
  const review = entry.kind === 'review' && entry.state ? REVIEW[entry.state] : null
  return (
    <li className="pr-comment" data-testid={id} data-kind={entry.kind}>
      <div className="pr-comment-head">
        <span className="pr-author">{entry.author}</span>
        {review && (
          <span
            className={`status tone-${review.tone}`}
            data-testid={`${id}-state`}
            data-state={entry.state}
          >
            {review.label}
          </span>
        )}
        {entry.url ? (
          <a className="pr-when" href={entry.url} target="_blank" rel="noreferrer" title={entry.at}>
            {formatAge(entry.at, now)}
          </a>
        ) : (
          <span className="pr-when" title={entry.at}>
            {formatAge(entry.at, now)}
          </span>
        )}
      </div>
      {entry.kind === 'line' && entry.path && (
        <p className="pr-path" data-testid={`${id}-path`}>
          {entry.line === null ? entry.path : `${entry.path}:${entry.line}`}
        </p>
      )}
      {entry.kind === 'line' && entry.hunk && (
        <details className="pr-hunk" data-testid={`${id}-hunk`}>
          <summary>Diff</summary>
          <pre className="pr-code">{entry.hunk}</pre>
        </details>
      )}
      {entry.body.trim() !== '' && <Body body={entry.body} />}
    </li>
  )
}

/** A workspace's pull request: its header, CI checks and conversation. Read-only. */
export default function PullRequestView({ termKey }: { termKey: string }): React.JSX.Element {
  const store = useStore()
  const { workspaces, prThreads, prThreadErrors, connected } = useQue()
  const ws = workspaces[termKey]
  const pr = ws?.pr ?? null
  const thread = prThreads[termKey] ?? null
  const error = prThreadErrors[termKey] ?? null
  const url = pr?.url ?? ws?.prUrl ?? null
  const number = pr?.number ?? (ws?.prUrl ? ws.prUrl.split('/').pop() : null)
  const now = store.now()

  // On mount; the store fetches again when the pull request changes upstream.
  useEffect(() => {
    void store.fetchPrThread(termKey)
  }, [store, termKey])

  const checks = pr?.checkRuns ?? []
  const entries: PrThreadEntry[] = thread?.entries ?? []
  const decision = pr?.review ? DECISION[pr.review] : null

  return (
    <section className="pr" data-testid="pr-view" aria-label="Pull request">
      {error && (
        <p className="pr-error form-error" role="alert" data-testid="pr-error">
          {error}
        </p>
      )}
      {pr ? (
        <div className="pr-body">
          <header className="pr-header">
            <a
              className="pr-title"
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              data-testid="pr-header-link"
            >
              #{pr.number} · {pr.state} · {pr.title}
            </a>
            {decision && (
              <span
                className={`status tone-${decision.tone}`}
                data-testid="pr-review"
                data-review={pr.review}
              >
                {decision.label}
              </span>
            )}
          </header>
          <section className="pr-section" aria-label="Checks" data-testid="pr-checks">
            <div className="section-head">
              <h2>Checks</h2>
              <span className="pr-count" data-testid="pr-checks-summary">
                {checksSummary(checks)}
              </span>
            </div>
            {checks.length === 0 ? (
              <p className="pr-note" data-testid="pr-checks-empty">
                No checks
              </p>
            ) : (
              <ul className="pr-checks">
                {checks.map((c, i) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: check names can repeat across sources
                    key={`${c.name}:${i}`}
                    className={`pr-check tone-${CHECK_TONE[c.state]}`}
                    data-testid={`pr-check-${i}`}
                    data-state={c.state}
                  >
                    <span className="pr-dot" title={c.state} />
                    <span className="pr-check-name">{c.name}</span>
                    {c.source && <span className="pr-check-source">{c.source}</span>}
                    <span className="pr-check-time">
                      {formatDuration(c.startedAt, c.completedAt)}
                    </span>
                    {c.url && (
                      <a
                        className="pr-check-link"
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${c.name}`}
                        data-testid={`pr-check-${i}-link`}
                      >
                        <ExternalLinkIcon />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="pr-section" aria-label="Comments" data-testid="pr-comments">
            <div className="section-head">
              <h2>Comments</h2>
              <span className="pr-count" data-testid="pr-comments-count">
                {entries.length}
              </span>
            </div>
            {entries.length === 0 ? (
              <p className="pr-note" data-testid="pr-comments-empty">
                No comments yet
              </p>
            ) : (
              <ol className="pr-comments">
                {entries.map((e, i) => (
                  <Comment key={e.id} entry={e} index={i} now={now} />
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : (
        <p className="pr-note pr-empty" data-testid="pr-empty">
          No pull request yet
        </p>
      )}
      <footer className="pr-footer">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" data-testid="pr-footer-link">
            #{number} on GitHub
          </a>
        ) : (
          <button
            type="button"
            className="pr-create"
            data-testid="pr-create"
            disabled={!connected || !ws}
            onClick={() => store.openDialog({ kind: 'create-pr', workspaceId: termKey })}
          >
            Create PR
          </button>
        )}
        <button
          type="button"
          className="ghost"
          data-testid="pr-refresh"
          disabled={!connected}
          onClick={() => void store.fetchPrThread(termKey, true)}
        >
          Refresh
        </button>
      </footer>
    </section>
  )
}
