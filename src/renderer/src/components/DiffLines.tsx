// A diff tab's lines: numbered, signed, syntax coloured, with folded context, one column or
// side by side, and a pull request's line comments under their lines. Changed comment lines are
// dimmed, drawn as code, or folded to a row per run, as the project chose.
import { Fragment, memo } from 'react'
import type { DiffLine, DiffToken, PrThreadEntry } from '../../../preload/index.d'
import { formatAge } from '../../../shared/format'
import type { CommentMode, CommentRunRow, DiffRow, FoldRow, GapRow, SplitRow } from '../diff-rows'
import type { DiffMode } from '../store'
import { useNow } from '../useNow'

const SIGN: Record<DiffLine['kind'], string> = { added: '+', removed: '−', context: '' }

/** A token's class: its kind, or a bracket's colour by depth (three, repeating); `mark` on top. */
function tokenClass(t: DiffToken): string {
  const kind = t.depth === undefined ? `tok-${t.kind}` : `tok-b${(t.depth % 3) + 1}`

  return t.mark ? `${kind} tok-mark` : kind
}

const Code = memo(function Code({ line }: { line: DiffLine }): React.JSX.Element {
  return (
    <span className="diff-code" data-testid="diff-line-code">
      {line.tokens.map((t, i) => (
        // tokens are static and have no identity
        <span key={i} className={tokenClass(t)}>
          {t.text}
        </span>
      ))}
    </span>
  )
})

/** A line comment under its line: who and when, then what it says. */
function LineComment({ entry }: { entry: PrThreadEntry }): React.JSX.Element {
  const now = useNow()

  return (
    <div className="line-comment" data-testid={`diff-comment-${entry.id}`}>
      <span className="line-comment-who">
        {entry.author} · {formatAge(entry.at, now, ' ago')}
      </span>
      <span className="line-comment-body">{entry.body}</span>
    </div>
  )
}

/** What a diff tab's rows do when clicked: reveal a fold (or the comment changes it took in), open a comment run. */
export interface RowActions {
  onReveal: (fold: FoldRow, how: 'down' | 'up' | 'all' | 'comments') => void
  onToggleRun: (row: CommentRunRow) => void
}

/** How the rows draw changed comment lines. */
export interface CommentDraw {
  mode: CommentMode
  keepRemoved: boolean
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** `1 removed, 4 added`, leaving out a side with none. */
function changeWords(removed: number, added: number): string {
  return [removed > 0 && `${removed} removed`, added > 0 && `${added} added`]
    .filter(Boolean)
    .join(', ')
}

function FoldBar({ row, actions }: { row: FoldRow; actions: RowActions }): React.JSX.Element {
  const { onReveal } = actions
  const unchanged = row.hidden - (row.comments ? row.comments.added + row.comments.removed : 0)

  return (
    <div className="diff-fold" data-testid={`diff-fold-${row.id}`}>
      <span className="diff-fold-inner">
        {row.up > 0 && (
          <button
            type="button"
            className="diff-fold-step"
            data-testid={`diff-fold-${row.id}-up`}
            aria-label={`Show ${row.up} lines above`}
            onClick={() => onReveal(row, 'up')}
          >
            ↑ {row.up}
          </button>
        )}
        {row.down > 0 && (
          <button
            type="button"
            className="diff-fold-step"
            data-testid={`diff-fold-${row.id}-down`}
            aria-label={`Show ${row.down} lines below`}
            onClick={() => onReveal(row, 'down')}
          >
            ↓ {row.down}
          </button>
        )}
        <button
          type="button"
          className="diff-fold-all"
          data-testid={`diff-fold-${row.id}-all`}
          onClick={() => onReveal(row, 'all')}
        >
          {plural(unchanged, 'unchanged line', 'unchanged lines')}
        </button>
        {row.comments && (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              className="diff-fold-all"
              data-testid={`diff-fold-${row.id}-comments`}
              onClick={() => onReveal(row, 'comments')}
            >
              ▸ comment-only change: {changeWords(row.comments.removed, row.comments.added)}
            </button>
          </>
        )}
        {row.label && <span className="diff-fold-label">{row.label}</span>}
      </span>
    </div>
  )
}

function GapBar({ row }: { row: GapRow }): React.JSX.Element {
  return (
    <div className="diff-fold" data-testid={`diff-${row.id.replace(':', '-')}`}>
      <span className="diff-fold-inner">
        <span>
          {row.count} unchanged {row.count === 1 ? 'line' : 'lines'}
        </span>
        {row.label && <span className="diff-fold-label">{row.label}</span>}
      </span>
    </div>
  )
}

/** `3 comment lines added`, `1 comment line removed`, `2 comment lines changed`. */
function runWords(row: CommentRunRow): string {
  const how = row.removed === 0 ? 'added' : row.added === 0 ? 'removed' : 'changed'

  return `${plural(row.added + row.removed, 'comment line', 'comment lines')} ${how}`
}

/**
 * A run of comment lines under Fold: a slim row with the run's line range where the numbers go
 * and a button that opens it in place (or folds it again); a run a review comment points into
 * stays open and says why.
 */
function CommentRunBar({
  row,
  actions
}: {
  row: CommentRunRow
  actions: RowActions
}): React.JSX.Element {
  const range = row.first === row.last ? `${row.first}` : `${row.first}–${row.last}`

  return (
    <div
      className="diff-comment-run"
      data-testid={`diff-comments-${row.id}`}
      data-open={row.open}
      data-pinned={row.pinned || undefined}
    >
      <span className="diff-comment-range">{range}</span>
      {row.pinned ? (
        <span className="diff-comment-toggle">▾ comment lines · opened for a review comment</span>
      ) : (
        <button
          type="button"
          className="diff-comment-toggle"
          aria-expanded={row.open}
          onClick={() => actions.onToggleRun(row)}
        >
          {row.open ? '▾' : '▸'} {runWords(row)}
        </button>
      )}
    </div>
  )
}

/** How a changed comment line is drawn: dimmed or not, and whether it carries the removed tag. */
interface CommentLook {
  dim: { 'data-comment'?: true }
  kept: boolean
}

function commentAttrs(line: DiffLine, draw: CommentDraw): CommentLook {
  if (!line.comment || line.kind === 'context' || draw.mode === 'show') {
    return { dim: {}, kept: false }
  }

  return {
    dim: { 'data-comment': true },
    kept: draw.mode === 'fold' && draw.keepRemoved && line.kind === 'removed'
  }
}

/** The tag at the right end of a removed comment line Fold keeps in view. */
function RemovedTag(): React.JSX.Element {
  return (
    <span className="diff-comment-tag" data-testid="diff-comment-removed">
      comment removed
    </span>
  )
}

/** The comments on a line of the new file. */
function commentsOn(
  n: number | null | undefined,
  comments: readonly PrThreadEntry[]
): PrThreadEntry[] {
  return n == null ? [] : comments.filter((c) => c.line === n)
}

/** A row's line in the new file, and whether a line comment asked for it. */
interface LineAttrs {
  'data-line'?: number
  'data-target'?: true
}

const lineAttrs = (n: number | null | undefined, target: number | null): LineAttrs => ({
  'data-line': n ?? undefined,
  'data-target': n != null && n === target ? true : undefined
})

function UnifiedRows({
  rows,
  comments,
  target,
  draw,
  actions
}: {
  rows: readonly DiffRow[]
  comments: readonly PrThreadEntry[]
  target: number | null
  draw: CommentDraw
  actions: RowActions
}): React.JSX.Element {
  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'fold') return <FoldBar key={row.id} row={row} actions={actions} />

        if (row.kind === 'comments') {
          return <CommentRunBar key={row.id} row={row} actions={actions} />
        }

        if (row.kind === 'gap') return <GapBar key={row.id} row={row} />
        const { line } = row
        const { dim, kept } = commentAttrs(line, draw)

        return (
          <Fragment key={row.index}>
            <div
              className="diff-row"
              data-testid="diff-line"
              data-kind={line.kind}
              data-kept={kept || undefined}
              {...dim}
              {...lineAttrs(line.new, target)}
            >
              <span className="diff-num" data-testid="diff-line-old">
                {line.old ?? ''}
              </span>
              <span className="diff-num" data-testid="diff-line-new">
                {line.new ?? ''}
              </span>
              <span className="diff-sign">{SIGN[line.kind]}</span>
              <Code line={line} />
              {kept && <RemovedTag />}
            </div>
            {commentsOn(line.new, comments).map((c) => (
              <LineComment key={c.id} entry={c} />
            ))}
          </Fragment>
        )
      })}
    </>
  )
}

/** One side of a split row: its number, sign and code, or a hatched filler when it has none. */
function Side({
  line,
  side,
  draw
}: {
  line: DiffLine | null
  side: 'old' | 'new'
  draw: CommentDraw
}): React.JSX.Element {
  if (!line) {
    return <span className="diff-side" data-kind="filler" data-testid={`diff-split-${side}`} />
  }

  const { dim, kept } = commentAttrs(line, draw)

  return (
    <span
      className="diff-side"
      data-kind={line.kind}
      data-kept={kept || undefined}
      {...dim}
      data-testid={`diff-split-${side}`}
    >
      <span className="diff-num" data-testid="diff-line-num">
        {(side === 'old' ? line.old : line.new) ?? ''}
      </span>
      <span className="diff-sign">{SIGN[line.kind]}</span>
      <Code line={line} />
      {kept && <RemovedTag />}
    </span>
  )
}

function SplitRows({
  rows,
  comments,
  target,
  draw,
  actions
}: {
  rows: readonly SplitRow[]
  comments: readonly PrThreadEntry[]
  target: number | null
  draw: CommentDraw
  actions: RowActions
}): React.JSX.Element {
  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'fold') return <FoldBar key={row.id} row={row} actions={actions} />

        if (row.kind === 'comments') {
          return <CommentRunBar key={row.id} row={row} actions={actions} />
        }

        if (row.kind === 'gap') return <GapBar key={row.id} row={row} />

        return (
          <Fragment key={row.index}>
            <div
              className="diff-split-row"
              data-testid="diff-split-row"
              {...lineAttrs(row.right?.new, target)}
            >
              <Side line={row.left} side="old" draw={draw} />
              <Side line={row.right} side="new" draw={draw} />
            </div>
            {commentsOn(row.right?.new, comments).map((c) => (
              <LineComment key={c.id} entry={c} />
            ))}
          </Fragment>
        )
      })}
    </>
  )
}

/** The widest line's length in characters (a tab as four), for the split view's columns. */
function widest(rows: readonly SplitRow[]): number {
  let max = 0

  for (const r of rows) {
    if (r.kind !== 'pair') continue

    for (const l of [r.left, r.right]) {
      if (!l) continue
      const n = l.tokens.reduce((sum, t) => sum + t.text.replace(/\t/g, '    ').length, 0)

      if (n > max) max = n
    }
  }

  return max
}

/** The lines of a diff tab in its mode; rebuilt only when the rows, comments or target change. */
export const DiffLines = memo(function DiffLines({
  mode,
  rows,
  split,
  comments,
  target,
  draw,
  actions
}: {
  mode: DiffMode
  rows: readonly DiffRow[]
  split: readonly SplitRow[] | null
  comments: readonly PrThreadEntry[]
  target: number | null
  draw: CommentDraw
  actions: RowActions
}): React.JSX.Element {
  if (mode === 'split' && split) {
    return (
      <div
        className="diff-lines split"
        style={{ '--code-ch': `${widest(split)}ch` } as React.CSSProperties}
      >
        <SplitRows rows={split} comments={comments} target={target} draw={draw} actions={actions} />
      </div>
    )
  }

  return (
    <div className="diff-lines unified">
      <UnifiedRows rows={rows} comments={comments} target={target} draw={draw} actions={actions} />
    </div>
  )
})
