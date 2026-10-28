import { useState } from 'react'
import type { PrCheck, PrThreadEntry } from '../../../preload/index.d'
import { formatAge, formatSpan } from '../../../shared/format'
import { CHECK_TONE, REVIEW_TEXT, reviewBadge } from '../format'
import { baseLabel, checkGroups, checksCount } from '../pr-list'
import { splitFences } from '../pr-text'
import {
  diffId,
  diffKey,
  keyOf,
  type PrSection,
  prAgainst,
  usePanes,
  useQueSelector,
  useStore
} from '../store'
import { useNow } from '../useNow'
import { ChevronIcon, ExternalLinkIcon } from './icons'
import { DiffTotals, Dot, FileRow, PrDotMark } from './ReviewParts'

/** A comment body: text with its line breaks, fenced blocks in mono. */
function Body({ body }: { body: string }): React.JSX.Element {
  return (
    <div className="pr-comment-body">
      {splitFences(body).map((part, i) =>
        part.kind === 'code' ? (
          // the parts of one body are static
          <pre key={i} className="pr-code" data-lang={part.lang || undefined}>
            {part.text}
          </pre>
        ) : (
          // the parts of one body are static
          <p key={i} className="pr-text">
            {part.text}
          </p>
        )
      )}
    </div>
  )
}

/** One entry of the conversation; a line comment's `path:line` opens the diff at that line. */
export function Comment({
  entry,
  index,
  now,
  onOpenLine
}: {
  entry: PrThreadEntry
  index: number
  now: number
  onOpenLine?: (path: string, line: number | undefined) => void
}): React.JSX.Element {
  const id = `pr-comment-${index}`
  const review = entry.kind === 'review' && entry.state ? reviewBadge(entry.state) : null
  const where = entry.path && (entry.line === null ? entry.path : `${entry.path}:${entry.line}`)

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
            {formatAge(entry.at, now, ' ago')}
          </a>
        ) : (
          <span className="pr-when" title={entry.at}>
            {formatAge(entry.at, now, ' ago')}
          </span>
        )}
      </div>
      {entry.kind === 'line' &&
        entry.path &&
        (onOpenLine ? (
          <button
            type="button"
            className="pr-path"
            data-testid={`${id}-path`}
            title={`Open ${where}`}
            onClick={() => entry.path && onOpenLine(entry.path, entry.line ?? undefined)}
          >
            {where} →
          </button>
        ) : (
          <p className="pr-path" data-testid={`${id}-path`}>
            {where}
          </p>
        ))}
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

/** A section inside a pull request: a head that folds it, and what it holds while open. */
function Fold({
  section,
  label,
  right,
  children
}: {
  section: PrSection
  label: string
  right: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const store = useStore()
  const open = useQueSelector((s) => s.prFolds[section])

  return (
    <section className="pr-section" aria-label={label} data-testid={`pr-${section}`}>
      <button
        type="button"
        className="review-fold"
        aria-expanded={open}
        data-testid={`pr-${section}-head`}
        onClick={() => store.togglePrFold(section)}
      >
        <span className="label">
          <ChevronIcon open={open} /> [ {label} ]
        </span>
        <span className="review-sum">{right}</span>
      </button>
      {open && children}
    </section>
  )
}

function CheckRow({ check, index }: { check: PrCheck; index: number }): React.JSX.Element {
  return (
    <li className="pr-check" data-testid={`pr-check-${index}`} data-state={check.state}>
      <Dot tone={CHECK_TONE[check.state]} title={check.state} />
      <span className="pr-check-name">{check.name}</span>
      {check.source && <span className="pr-check-source">{check.source}</span>}
      <span className="pr-check-time">{formatSpan(check.startedAt, check.completedAt)}</span>
      {check.url && (
        <a
          className="pr-check-link"
          href={check.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${check.name}`}
          data-testid={`pr-check-${index}-link`}
        >
          <ExternalLinkIcon />
        </a>
      )}
    </li>
  )
}

/**
 * One of the session's pull requests, open in place in the review pane: its title and state,
 * then its files, checks and comments, each folding at its head. A file opens the pull
 * request's own diff of it as a tab in the middle. Read-only.
 */
export default function PullRequestDetail({
  termKey,
  number
}: {
  termKey: string
  number: number
}): React.JSX.Element | null {
  const store = usePanes(termKey)
  const ws = useQueSelector((s) => s.workspaces[termKey])
  const pr = ws?.prs.find((p) => p.number === number)
  const against = pr && prAgainst(pr)
  const threadEntry = useQueSelector((s) => s.prThreads[keyOf(termKey, number)])

  const diffEntry = useQueSelector((s) =>
    against ? s.diffs[diffKey(termKey, against)] : undefined
  )

  const [passingOpen, setPassingOpen] = useState(false)
  const activeId = store.paneActiveId(termKey, store.focusedPane(termKey))
  const now = useNow()

  if (!ws || !pr || !against) return null

  const thread = threadEntry?.data ?? null
  const entries: PrThreadEntry[] = thread?.entries ?? []
  const files = diffEntry?.data?.files ?? []
  const into = baseLabel(pr, ws.prs)
  const checks = pr.checkRuns
  const { listed, passing } = checkGroups(checks)
  const count = checksCount(checks)

  const openLine = (path: string, line?: number): void =>
    store.openDiff(termKey, path, { against, line })

  return (
    <section className="pr" data-testid="pr-view" data-pr={number} aria-label={`#${number}`}>
      {threadEntry?.error && (
        <p className="pr-error form-error" role="alert" data-testid="pr-error">
          {threadEntry.error}
        </p>
      )}
      <div className="pr-body">
        <header className="pr-header">
          <h2 className="pr-title" data-testid="pr-title">
            {pr.title}
          </h2>
          <p className="pr-meta" data-testid="pr-meta">
            <span className="pr-state" data-testid="pr-state" data-state={pr.state}>
              <PrDotMark pr={pr} />
              {pr.state}
            </span>
            <a href={pr.url} target="_blank" rel="noreferrer" data-testid="pr-header-link">
              #{pr.number} ↗
            </a>
            <span>into {into}</span>
          </p>
        </header>
        <Fold
          section="files"
          label="Changes"
          right={
            <span data-testid="pr-files-summary">
              {diffEntry?.data ? (
                <>
                  <DiffTotals files={files} /> · vs {into}
                </>
              ) : (
                `vs ${into}`
              )}
            </span>
          }
        >
          {diffEntry?.error && (
            <p className="form-error changes-error" role="alert" data-testid="pr-files-error">
              {diffEntry.error}
            </p>
          )}
          {diffEntry?.data && files.length === 0 && (
            <p className="pr-note" data-testid="pr-files-empty">
              No files against {into}
            </p>
          )}
          {files.length > 0 && (
            <div className="changes-files" role="listbox" aria-label={`Files of #${number}`}>
              {files.map((f, i) => (
                <FileRow
                  key={f.path}
                  file={f}
                  testId={`pr-file-${i}`}
                  active={activeId === diffId(f.path, against)}
                  onOpen={() => openLine(f.path)}
                />
              ))}
            </div>
          )}
        </Fold>
        <hr className="review-rule" />
        <Fold
          section="checks"
          label="Checks"
          right={
            <span data-testid="pr-checks-summary">
              {count.failing > 0 && <span className="tone-bad">{count.failing} failing</span>}
              {count.failing > 0 && count.words.length > 0 && ' · '}
              {count.words.join(' · ')}
            </span>
          }
        >
          {checks.length === 0 ? (
            <p className="pr-note" data-testid="pr-checks-empty">
              No checks
            </p>
          ) : (
            <ul className="pr-checks">
              {listed.map((c, i) => (
                // check names can repeat across sources
                <CheckRow key={`${c.name}:${i}`} check={c} index={i} />
              ))}
              {passing.length > 0 && (
                <li>
                  <button
                    type="button"
                    className="pr-checks-fold"
                    aria-expanded={passingOpen}
                    data-testid="pr-checks-passing"
                    onClick={() => setPassingOpen((o) => !o)}
                  >
                    <ChevronIcon open={passingOpen} /> {passing.length} passing
                    {!passingOpen && ` · ${passing.map((c) => c.name).join(', ')}`}
                  </button>
                </li>
              )}
              {passingOpen &&
                passing.map((c, i) => (
                  <CheckRow key={`${c.name}:p${i}`} check={c} index={listed.length + i} />
                ))}
            </ul>
          )}
        </Fold>
        <hr className="review-rule" />
        <Fold
          section="comments"
          label="Comments"
          right={
            <span data-testid="pr-comments-count">
              {entries.length}
              {pr.review && ` · ${REVIEW_TEXT[pr.review]}`}
            </span>
          }
        >
          {entries.length === 0 ? (
            <p className="pr-note" data-testid="pr-comments-empty">
              No comments yet
            </p>
          ) : (
            <ol className="pr-comments">
              {entries.map((e, i) => (
                <Comment key={e.id} entry={e} index={i} now={now} onOpenLine={openLine} />
              ))}
            </ol>
          )}
        </Fold>
      </div>
    </section>
  )
}
