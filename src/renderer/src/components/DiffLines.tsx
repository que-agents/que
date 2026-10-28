// A diff tab's lines: numbered, signed, syntax coloured, with folded context, one column or
// side by side, and a pull request's line comments under their lines.
import { Fragment, memo } from 'react'
import type { DiffLine, DiffToken, PrThreadEntry } from '../../../preload/index.d'
import { formatAge } from '../../../shared/format'
import type { DiffRow, FoldRow, GapRow, SplitRow } from '../diff-rows'
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

function FoldBar({
  row,
  onReveal
}: {
  row: FoldRow
  onReveal: (fold: FoldRow, how: 'down' | 'up' | 'all') => void
}): React.JSX.Element {
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
          {row.hidden} unchanged {row.hidden === 1 ? 'line' : 'lines'}
        </button>
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
  onReveal
}: {
  rows: readonly DiffRow[]
  comments: readonly PrThreadEntry[]
  target: number | null
  onReveal: (fold: FoldRow, how: 'down' | 'up' | 'all') => void
}): React.JSX.Element {
  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'fold') return <FoldBar key={row.id} row={row} onReveal={onReveal} />

        if (row.kind === 'gap') return <GapBar key={row.id} row={row} />
        const { line } = row

        return (
          <Fragment key={row.index}>
            <div
              className="diff-row"
              data-testid="diff-line"
              data-kind={line.kind}
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
function Side({ line, side }: { line: DiffLine | null; side: 'old' | 'new' }): React.JSX.Element {
  if (!line) {
    return <span className="diff-side" data-kind="filler" data-testid={`diff-split-${side}`} />
  }

  return (
    <span className="diff-side" data-kind={line.kind} data-testid={`diff-split-${side}`}>
      <span className="diff-num" data-testid="diff-line-num">
        {(side === 'old' ? line.old : line.new) ?? ''}
      </span>
      <span className="diff-sign">{SIGN[line.kind]}</span>
      <Code line={line} />
    </span>
  )
}

function SplitRows({
  rows,
  comments,
  target,
  onReveal
}: {
  rows: readonly SplitRow[]
  comments: readonly PrThreadEntry[]
  target: number | null
  onReveal: (fold: FoldRow, how: 'down' | 'up' | 'all') => void
}): React.JSX.Element {
  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'fold') return <FoldBar key={row.id} row={row} onReveal={onReveal} />

        if (row.kind === 'gap') return <GapBar key={row.id} row={row} />

        return (
          <Fragment key={row.index}>
            <div
              className="diff-split-row"
              data-testid="diff-split-row"
              {...lineAttrs(row.right?.new, target)}
            >
              <Side line={row.left} side="old" />
              <Side line={row.right} side="new" />
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
  onReveal
}: {
  mode: DiffMode
  rows: readonly DiffRow[]
  split: readonly SplitRow[] | null
  comments: readonly PrThreadEntry[]
  target: number | null
  onReveal: (fold: FoldRow, how: 'down' | 'up' | 'all') => void
}): React.JSX.Element {
  if (mode === 'split' && split) {
    return (
      <div
        className="diff-lines split"
        style={{ '--code-ch': `${widest(split)}ch` } as React.CSSProperties}
      >
        <SplitRows rows={split} comments={comments} target={target} onReveal={onReveal} />
      </div>
    )
  }

  return (
    <div className="diff-lines unified">
      <UnifiedRows rows={rows} comments={comments} target={target} onReveal={onReveal} />
    </div>
  )
})
