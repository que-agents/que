// A diff tab's lines: numbered, signed, syntax coloured, with folded context, one column or
// side by side, and a pull request's line comments under their lines. Changed comment lines are
// dimmed, drawn as code, or folded to a row per run, as the project chose.
import { Fragment, memo, useMemo } from 'react'
import type { DiffLine, DiffToken, PrThreadEntry } from '../../../preload/index.d'
import { formatAge, plural } from '../../../shared/format'
import type {
  CommentRunRow,
  DiffComments,
  DiffRow,
  FoldRow,
  LineRow,
  PairRow,
  SplitRow
} from '../diff-rows'
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

const unchanged = (n: number): string => plural(n, 'unchanged line')

/** `1 removed, 4 added`, leaving out a side with none. */
function changeWords(removed: number, added: number): string {
  return [removed > 0 && `${removed} removed`, added > 0 && `${added} added`]
    .filter(Boolean)
    .join(', ')
}

/** A row standing for unchanged lines, across both sides: its controls, then the label. */
function FoldShell({
  testid,
  label,
  children
}: {
  testid: string
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="diff-fold" data-testid={testid}>
      <span className="diff-fold-inner">
        {children}
        {label && <span className="diff-fold-label">{label}</span>}
      </span>
    </div>
  )
}

/**
 * Folded lines: ↑ and ↓ reveal twenty from that side, the count reveals them all, and the
 * comment-only changes the fold took in show on their own.
 */
function FoldBar({ row, actions }: { row: FoldRow; actions: RowActions }): React.JSX.Element {
  const { onReveal } = actions
  const taken = row.comments ? row.comments.added + row.comments.removed : 0

  return (
    <FoldShell testid={`diff-fold-${row.id}`} label={row.label}>
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
        {unchanged(row.hidden - taken)}
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
    </FoldShell>
  )
}

/** `3 comment lines added`, `1 comment line removed`, `2 comment lines changed`. */
function runWords(row: CommentRunRow): string {
  const how = row.removed === 0 ? 'added' : row.added === 0 ? 'removed' : 'changed'

  return `${plural(row.added + row.removed, 'comment line')} ${how}`
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

/** Whether a changed comment line is drawn dimmed, and whether it carries the removed tag. */
interface CommentLook {
  dimmed: boolean
  kept: boolean
}

function commentLook(line: DiffLine, prefs: DiffComments): CommentLook {
  const dimmed = line.comment === true && line.kind !== 'context' && prefs.mode !== 'show'

  return {
    dimmed,
    kept: dimmed && prefs.mode === 'fold' && prefs.keepRemoved && line.kind === 'removed'
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

/** A row's line in the new file, and whether a line comment asked for it. */
interface LineAttrs {
  'data-line'?: number
  'data-target'?: true
}

const lineAttrs = (n: number | null | undefined, target: number | null): LineAttrs => ({
  'data-line': n ?? undefined,
  'data-target': n != null && n === target ? true : undefined
})

const NO_COMMENTS: readonly PrThreadEntry[] = []

/**
 * The rows of either layout: folds, gaps and comment runs drawn the same way, each line row
 * drawn by `renderLine` with the comments on its line of the new file under it.
 */
function Rows<L extends LineRow | PairRow>({
  rows,
  byLine,
  target,
  actions,
  newLine,
  renderLine
}: {
  rows: ReadonlyArray<L | Exclude<DiffRow, LineRow>>
  byLine: ReadonlyMap<number, readonly PrThreadEntry[]>
  target: number | null
  actions: RowActions
  newLine: (row: L) => number | null | undefined
  renderLine: (row: L, attrs: LineAttrs) => React.JSX.Element
}): React.JSX.Element {
  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'fold') return <FoldBar key={row.id} row={row} actions={actions} />

        if (row.kind === 'comments') {
          return <CommentRunBar key={row.id} row={row} actions={actions} />
        }

        if (row.kind === 'gap') {
          return (
            <FoldShell key={row.id} testid={`diff-${row.id.replace(':', '-')}`} label={row.label}>
              <span>{unchanged(row.count)}</span>
            </FoldShell>
          )
        }

        const n = newLine(row)

        return (
          <Fragment key={row.index}>
            {renderLine(row, lineAttrs(n, target))}
            {(n == null ? NO_COMMENTS : (byLine.get(n) ?? NO_COMMENTS)).map((c) => (
              <LineComment key={c.id} entry={c} />
            ))}
          </Fragment>
        )
      })}
    </>
  )
}

function UnifiedLine({
  row,
  attrs,
  prefs
}: {
  row: LineRow
  attrs: LineAttrs
  prefs: DiffComments
}): React.JSX.Element {
  const { line } = row
  const { dimmed, kept } = commentLook(line, prefs)

  return (
    <div
      className="diff-row"
      data-testid="diff-line"
      data-kind={line.kind}
      data-comment={dimmed || undefined}
      data-kept={kept || undefined}
      {...attrs}
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
  )
}

/** One side of a split row: its number, sign and code, or a hatched filler when it has none. */
function Side({
  line,
  side,
  prefs
}: {
  line: DiffLine | null
  side: 'old' | 'new'
  prefs: DiffComments
}): React.JSX.Element {
  if (!line) {
    return <span className="diff-side" data-kind="filler" data-testid={`diff-split-${side}`} />
  }

  const { dimmed, kept } = commentLook(line, prefs)

  return (
    <span
      className="diff-side"
      data-kind={line.kind}
      data-comment={dimmed || undefined}
      data-kept={kept || undefined}
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
  prefs,
  actions
}: {
  mode: DiffMode
  rows: readonly DiffRow[]
  split: readonly SplitRow[] | null
  comments: readonly PrThreadEntry[]
  target: number | null
  prefs: DiffComments
  actions: RowActions
}): React.JSX.Element {
  // Each line comment under the line of the new file it is on, looked up once per row.
  const byLine = useMemo(() => {
    const map = new Map<number, PrThreadEntry[]>()

    for (const c of comments) {
      if (c.line === null) continue
      map.set(c.line, [...(map.get(c.line) ?? []), c])
    }

    return map
  }, [comments])

  if (mode === 'split' && split) {
    return (
      <div
        className="diff-lines split"
        style={{ '--code-ch': `${widest(split)}ch` } as React.CSSProperties}
      >
        <Rows
          rows={split}
          byLine={byLine}
          target={target}
          actions={actions}
          newLine={(r: PairRow) => r.right?.new}
          renderLine={(r: PairRow, attrs) => (
            <div className="diff-split-row" data-testid="diff-split-row" {...attrs}>
              <Side line={r.left} side="old" prefs={prefs} />
              <Side line={r.right} side="new" prefs={prefs} />
            </div>
          )}
        />
      </div>
    )
  }

  return (
    <div className="diff-lines unified">
      <Rows
        rows={rows}
        byLine={byLine}
        target={target}
        actions={actions}
        newLine={(r: LineRow) => r.line.new}
        renderLine={(r: LineRow, attrs) => <UnifiedLine row={r} attrs={attrs} prefs={prefs} />}
      />
    </div>
  )
})
