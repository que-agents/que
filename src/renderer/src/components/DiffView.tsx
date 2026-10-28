import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PrThreadEntry, WorkspaceDiffFile } from '../../../preload/index.d'
import { plural } from '../../../shared/format'
import {
  type CommentMode,
  type CommentRunRow,
  type CommentView,
  type DiffComments,
  type FoldRow,
  type LineSplit,
  NO_REVEALS,
  diffRows,
  fileLines,
  revealComments,
  revealLine,
  revealMore,
  splitCounts,
  splitRows,
  toggleCommentRun
} from '../diff-rows'
import { baseLabel } from '../pr-list'
import {
  DEFAULT_DIFF_COMMENTS,
  type DiffAgainst,
  diffFileKey,
  diffId,
  diffKey,
  keyOf,
  prOfDiff,
  useQueSelector,
  useStore
} from '../store'
import { DiffLines, type RowActions } from './DiffLines'
import Menu, { type MenuItem } from './Menu'

const SKIPPED: Record<NonNullable<WorkspaceDiffFile['skipped']>, string> = {
  binary: 'Binary file.',
  'too-large': 'Too large to show.'
}

/** The Comments button's word for each mode. */
const MODE_WORD: Record<CommentMode, string> = { dim: 'dimmed', show: 'shown', fold: 'folded' }

const MODES: ReadonlyArray<{ mode: CommentMode; label: string; hint: string }> = [
  { mode: 'dim', label: 'Dim', hint: 'default' },
  { mode: 'show', label: 'Show', hint: 'as code' },
  { mode: 'fold', label: 'Fold', hint: 'one row each' }
]

/**
 * The toolbar's path: its folders truncate from their start, so the file's name stays in view;
 * the whole of it is the tooltip.
 */
function DiffPath({ text }: { text: string }): React.JSX.Element {
  const cut = text.lastIndexOf('/') + 1

  return (
    <span className="diff-path" title={text} data-testid="diff-path">
      {cut > 0 && (
        <span className="diff-path-dir" data-truncate="start">
          <span dir="ltr">{text.slice(0, cut)}</span>
        </span>
      )}
      <span className="diff-path-name">{text.slice(cut)}</span>
    </span>
  )
}

/** One side of a count (`+2`, `−1`), left out when it is zero and `optional`. */
function Count({
  sign,
  n,
  tone,
  testId,
  optional
}: {
  sign: string
  n: number
  tone?: string
  testId?: string
  optional: boolean
}): React.JSX.Element | null {
  if (optional && n === 0) return null

  return (
    <span className={tone ? `diff-count tone-${tone}` : undefined} data-testid={testId}>
      {sign}
      {n}
    </span>
  )
}

/**
 * The toolbar's counts: `+a −d` for a file without comment lines (the details' split, else the
 * listing's totals); with them, `+2 −1 code · +7 −2 comments`, a part or a side left out when it
 * is zero (a file of comments alone reads `+2 comments`).
 */
function Counts({
  additions,
  deletions,
  split
}: {
  additions: number
  deletions: number
  split: LineSplit | null
}): React.JSX.Element {
  const comments = split ? split.commentAdditions + split.commentDeletions : 0
  const adds = split && comments > 0 ? split.codeAdditions : additions
  const dels = split && comments > 0 ? split.codeDeletions : deletions
  const code = comments === 0 || adds + dels > 0

  return (
    <>
      {code && (
        <span className="diff-code-counts" data-testid="diff-code-counts">
          <Count sign="+" n={adds} tone="good" testId="diff-additions" optional={comments > 0} />
          <Count sign="−" n={dels} tone="bad" testId="diff-deletions" optional={comments > 0} />
          {comments > 0 && <span>code ·</span>}
        </span>
      )}
      {split && comments > 0 && (
        <span className="diff-comment-counts" data-testid="diff-comment-counts">
          <Count sign="+" n={split.commentAdditions} optional />
          <Count sign="−" n={split.commentDeletions} optional />
          <span>comments</span>
        </span>
      )}
    </>
  )
}

/**
 * The toolbar under the tab strip: the path and its counts (for a pull request's diff, what it
 * is against) at the left; the Comments menu (only when there are comment lines), Unified |
 * Split, Wrap and Whitespace at the right, dropping under the path when they do not fit beside it.
 */
function DiffToolbar({
  path,
  from,
  additions,
  deletions,
  split,
  against,
  prefs,
  onComments
}: {
  path: string
  from: string | null
  additions: number
  deletions: number
  /** The detail's counts, code apart from comments; null until the lines land. */
  split: LineSplit | null
  against: string | null
  prefs: DiffComments
  onComments: (change: Partial<DiffComments>) => void
}): React.JSX.Element {
  const store = useStore()
  const mode = useQueSelector((s) => s.diffMode)
  const whitespace = useQueSelector((s) => s.diffWhitespace)
  const wrap = useQueSelector((s) => s.diffWrap)
  const [menu, setMenu] = useState(false)
  const closeMenu = useCallback(() => setMenu(false), [])
  const button = useRef<HTMLButtonElement>(null)
  const commentLines = split ? split.commentAdditions + split.commentDeletions : 0

  const items: MenuItem[] = [
    ...MODES.map((m) => ({
      label: m.label,
      hint: m.hint,
      testId: m.mode,
      selected: prefs.mode === m.mode,
      action: () => onComments({ mode: m.mode })
    })),
    {
      label: 'Always show removed comments',
      testId: 'keep-removed',
      checked: prefs.keepRemoved,
      separated: true,
      action: () => onComments({ keepRemoved: !prefs.keepRemoved })
    }
  ]

  return (
    <header className="diff-header" data-testid="diff-header">
      <span className="diff-head-main">
        <DiffPath text={from ? `${from} → ${path}` : path} />
        <Counts additions={additions} deletions={deletions} split={split} />
        {against && (
          <span className="diff-against" data-testid="diff-against">
            {against}
          </span>
        )}
      </span>
      <span className="diff-tools">
        {commentLines > 0 && (
          <span className="diff-comments-pick">
            <button
              type="button"
              className="diff-tool"
              ref={button}
              data-testid="diff-comments-button"
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-pressed={menu}
              onClick={() => setMenu((m) => !m)}
            >
              Comments {MODE_WORD[prefs.mode]} ▾
            </button>
            {menu && (
              <Menu
                label="Comment changes"
                testId="diff-comments"
                head={`Comment changes · ${plural(commentLines, 'line')}`}
                className="diff-comments-menu"
                items={items}
                anchor={button}
                onClose={closeMenu}
              />
            )}
          </span>
        )}
        <span className="diff-segmented" role="group" aria-label="Layout">
          <button
            type="button"
            className="diff-tool"
            data-testid="diff-mode-unified"
            aria-pressed={mode === 'unified'}
            onClick={() => store.setDiffMode('unified')}
          >
            Unified
          </button>
          <button
            type="button"
            className="diff-tool"
            data-testid="diff-mode-split"
            aria-pressed={mode === 'split'}
            onClick={() => store.setDiffMode('split')}
          >
            Split
          </button>
        </span>
        <button
          type="button"
          className="diff-tool"
          data-testid="diff-wrap"
          title="Wrap long lines"
          aria-pressed={wrap}
          onClick={() => store.setDiffWrap(!wrap)}
        >
          Wrap
        </button>
        <button
          type="button"
          className="diff-tool"
          data-testid="diff-whitespace"
          title="Ignore whitespace"
          aria-pressed={whitespace === 'ignore'}
          onClick={() => store.setDiffWhitespace(whitespace === 'ignore' ? 'show' : 'ignore')}
        >
          Whitespace
        </button>
      </span>
    </header>
  )
}

/**
 * One changed file's diff as a tab beside the terminals. Read-only. Without `against`, the
 * workspace's diff against its base; with it, a branch's own diff against a base. When that
 * is a pull request's, it is headed `#188 vs #187` and its line comments show under their
 * lines. The workspace's diff says whether the file is changed at all; workspace.diffFile gives
 * its lines. A line asked for (openDiff's `line`) is unfolded and brought into view. Changed
 * comment lines are dimmed, shown or folded as the workspace's project chose.
 */
export default function DiffView({
  termKey,
  path,
  against
}: {
  termKey: string
  path: string
  against?: DiffAgainst
}): React.JSX.Element {
  const store = useStore()
  const entry = useQueSelector((s) => s.diffs[diffKey(termKey, against)])
  const ws = useQueSelector((s) => s.workspaces[termKey])
  const mode = useQueSelector((s) => s.diffMode)
  const whitespace = useQueSelector((s) => s.diffWhitespace)
  const wrap = useQueSelector((s) => s.diffWrap)
  const lines = useQueSelector((s) => s.diffFiles[diffFileKey(termKey, path, against, whitespace)])
  const project = ws?.projectId ?? termKey
  const prefs = useQueSelector((s) => s.diffComments[project]) ?? DEFAULT_DIFF_COMMENTS
  const tabId = diffId(path, against)
  const reveals = useQueSelector((s) => s.diffReveals[keyOf(termKey, tabId)]) ?? NO_REVEALS
  const pull = prOfDiff(ws?.prs ?? [], against)

  const thread = useQueSelector((s) =>
    pull ? s.prThreads[keyOf(termKey, pull.number)]?.data : undefined
  )

  const target = useQueSelector((s) => s.diffTargets[keyOf(termKey, tabId)])
  const diff = entry?.data ?? null
  const file = diff?.files.find((f) => f.path === path)
  const detail = lines?.data
  const error = entry?.error ?? lines?.error ?? null
  const codeRef = useRef<HTMLDivElement>(null)
  const scrolled = useRef<number | null>(null)

  const comments = useMemo(
    () =>
      (thread?.entries ?? []).filter(
        (e: PrThreadEntry) => e.kind === 'line' && e.path === path && e.line !== null
      ),
    [thread, path]
  )

  const head = against?.head
  const base = against?.base
  const number = pull?.number

  const scope = useMemo(
    () => (head === undefined ? undefined : { head, base: base ?? '' }),
    [head, base]
  )

  useEffect(() => {
    void store.ensureDiff(termKey, scope)
  }, [store, termKey, scope])

  useEffect(() => {
    void store.ensureDiffFile(termKey, path, scope)
  }, [store, termKey, path, scope, whitespace])

  useEffect(() => {
    if (number !== undefined) void store.ensurePrThread(termKey, number)
  }, [store, termKey, number])

  const targetLine = target?.line ?? null

  // The lines a review comment points at, and the one a link asked for, keep their comment runs open.
  const view = useMemo<CommentView>(() => {
    const targets = new Set<number>(
      comments.flatMap((c: PrThreadEntry) => (c.line === null ? [] : [c.line]))
    )

    if (targetLine !== null) targets.add(targetLine)

    return { ...prefs, targets }
  }, [comments, targetLine, prefs])

  const rows = useMemo(
    () => (detail ? diffRows(detail, reveals, view) : []),
    [detail, reveals, view]
  )

  const split = useMemo(() => (mode === 'split' ? splitRows(rows) : null), [mode, rows])
  const counts = useMemo(() => (detail ? splitCounts(fileLines(detail)) : null), [detail])

  const actions = useMemo<RowActions>(
    () => ({
      onReveal: (fold: FoldRow, how: 'down' | 'up' | 'all' | 'comments') =>
        store.setDiffReveals(
          termKey,
          tabId,
          how === 'comments' ? revealComments(reveals, fold) : revealMore(reveals, fold, how)
        ),
      onToggleRun: (row: CommentRunRow) =>
        store.setDiffReveals(termKey, tabId, toggleCommentRun(reveals, row))
    }),
    [store, termKey, tabId, reveals]
  )

  const onComments = useCallback(
    (change: Partial<DiffComments>) => store.setDiffComments(project, change),
    [store, project]
  )

  // A line comment asked for a line: unfold it, then bring it into view, once per ask.
  useEffect(() => {
    if (!target || !detail) return
    const next = revealLine(detail, reveals, target.line, view)

    if (next !== reveals) {
      store.setDiffReveals(termKey, tabId, next)

      return
    }

    if (scrolled.current === target.nonce) return
    const el = codeRef.current?.querySelector(`[data-line="${target.line}"]`)

    if (!el) return
    scrolled.current = target.nonce
    el.scrollIntoView?.({ block: 'center' })
  }, [target, detail, reveals, rows, mode, view, store, termKey, tabId])

  const shown = detail ?? file

  return (
    <section
      className="diff"
      data-testid="diff-view"
      data-path={path}
      data-pr={pull?.number}
      aria-label={`Diff of ${path}`}
    >
      {error && (
        <p className="form-error changes-error" role="alert" data-testid="diff-error">
          {error}
        </p>
      )}
      {file && shown ? (
        <>
          <DiffToolbar
            path={file.path}
            from={file.from}
            additions={shown.additions}
            deletions={shown.deletions}
            split={counts}
            against={pull && ws ? `#${pull.number} vs ${baseLabel(pull, ws.prs)}` : null}
            prefs={prefs}
            onComments={onComments}
          />
          {detail?.skipped ? (
            <p className="changes-note" data-testid={`diff-${detail.skipped}`}>
              {SKIPPED[detail.skipped]}
            </p>
          ) : detail && detail.hunks.length === 0 ? (
            <p className="changes-note" data-testid="diff-no-lines">
              {whitespace === 'ignore' ? 'Only whitespace changed.' : 'No lines changed.'}
            </p>
          ) : (
            detail && (
              <div
                className="diff-patch"
                data-testid="diff-patch"
                data-mode={mode}
                data-wrap={wrap || undefined}
                data-comments={prefs.mode}
                data-language={detail.language ?? 'plain'}
                ref={codeRef}
              >
                <DiffLines
                  mode={mode}
                  rows={rows}
                  split={split}
                  comments={comments}
                  target={targetLine}
                  prefs={prefs}
                  actions={actions}
                />
              </div>
            )
          )}
        </>
      ) : (
        diff && (
          <p className="changes-note" data-testid="diff-empty">
            No changes in {path}
          </p>
        )
      )}
    </section>
  )
}
