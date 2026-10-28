// A diff tab's lines: numbered, signed, syntax coloured, with folded context, one column or
// side by side, and a pull request's line comments under their lines.
import { Fragment, memo, useMemo } from 'react'
import type { DiffLine, DiffToken, PrThreadEntry } from '../../../preload/index.d'
import { formatAge } from '../../../shared/format'
import type { DiffRow, FoldRow, LineRow, PairRow, SplitRow } from '../diff-rows'
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

type Reveal = (fold: FoldRow, how: 'down' | 'up' | 'all') => void

const unchanged = (n: number): string => `${n} unchanged ${n === 1 ? 'line' : 'lines'}`

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

/** Folded lines: ↑ and ↓ reveal twenty from that side, the count reveals them all. */
function FoldBar({ row, onReveal }: { row: FoldRow; onReveal: Reveal }): React.JSX.Element {
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
        {unchanged(row.hidden)}
      </button>
    </FoldShell>
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
 * The rows of either layout: folds and gaps drawn the same way, each line row drawn by
 * `renderLine` with the comments on its line of the new file under it.
 */
function Rows<L extends LineRow | PairRow>({
  rows,
  byLine,
  target,
  onReveal,
  newLine,
  renderLine
}: {
  rows: ReadonlyArray<L | Exclude<DiffRow, LineRow>>
  byLine: ReadonlyMap<number, readonly PrThreadEntry[]>
  target: number | null
  onReveal: Reveal
  newLine: (row: L) => number | null | undefined
  renderLine: (row: L, attrs: LineAttrs) => React.JSX.Element
}): React.JSX.Element {
  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'fold') return <FoldBar key={row.id} row={row} onReveal={onReveal} />

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

function unifiedLine(row: LineRow, attrs: LineAttrs): React.JSX.Element {
  const { line } = row

  return (
    <div className="diff-row" data-testid="diff-line" data-kind={line.kind} {...attrs}>
      <span className="diff-num" data-testid="diff-line-old">
        {line.old ?? ''}
      </span>
      <span className="diff-num" data-testid="diff-line-new">
        {line.new ?? ''}
      </span>
      <span className="diff-sign">{SIGN[line.kind]}</span>
      <Code line={line} />
    </div>
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

function splitLine(row: PairRow, attrs: LineAttrs): React.JSX.Element {
  return (
    <div className="diff-split-row" data-testid="diff-split-row" {...attrs}>
      <Side line={row.left} side="old" />
      <Side line={row.right} side="new" />
    </div>
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
  onReveal: Reveal
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
          onReveal={onReveal}
          newLine={(r: PairRow) => r.right?.new}
          renderLine={splitLine}
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
        onReveal={onReveal}
        newLine={(r: LineRow) => r.line.new}
        renderLine={unifiedLine}
      />
    </div>
  )
})
