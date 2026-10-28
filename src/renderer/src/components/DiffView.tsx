import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { PrThreadEntry, WorkspaceDiffFile } from '../../../preload/index.d'
import { type FoldRow, NO_REVEALS, diffRows, revealLine, revealMore, splitRows } from '../diff-rows'
import { baseLabel } from '../pr-list'
import {
  type DiffAgainst,
  diffFileKey,
  diffId,
  diffKey,
  keyOf,
  prOfDiff,
  useQueSelector,
  useStore
} from '../store'
import { DiffLines } from './DiffLines'

const SKIPPED: Record<NonNullable<WorkspaceDiffFile['skipped']>, string> = {
  binary: 'Binary file.',
  'too-large': 'Too large to show.'
}

/**
 * The toolbar under the tab strip: the path and its counts (and, for a pull request's diff, what
 * it is against) at the left; Unified | Split and Whitespace at the right, both remembered.
 */
function DiffToolbar({
  path,
  from,
  additions,
  deletions,
  against
}: {
  path: string
  from: string | null
  additions: number
  deletions: number
  against: string | null
}): React.JSX.Element {
  const store = useStore()
  const mode = useQueSelector((s) => s.diffMode)
  const whitespace = useQueSelector((s) => s.diffWhitespace)

  return (
    <header className="diff-header" data-testid="diff-header">
      <span className="diff-path" title={from ? `${from} → ${path}` : path}>
        {from ? `${from} → ${path}` : path}
      </span>
      <span className="diff-count tone-good" data-testid="diff-additions">
        +{additions}
      </span>
      <span className="diff-count tone-bad" data-testid="diff-deletions">
        −{deletions}
      </span>
      {against && (
        <span className="diff-against" data-testid="diff-against">
          {against}
        </span>
      )}
      <span className="diff-tools">
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
 * its lines. A line asked for (openDiff's `line`) is unfolded and brought into view.
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
  const lines = useQueSelector((s) => s.diffFiles[diffFileKey(termKey, path, against, whitespace)])
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

  const rows = useMemo(() => (detail ? diffRows(detail, reveals) : []), [detail, reveals])
  const split = useMemo(() => (mode === 'split' ? splitRows(rows) : null), [mode, rows])

  const onReveal = useCallback(
    (fold: FoldRow, how: 'down' | 'up' | 'all') =>
      store.setDiffReveals(termKey, tabId, revealMore(reveals, fold, how)),
    [store, termKey, tabId, reveals]
  )

  // A line comment asked for a line: unfold it, then bring it into view, once per ask.
  useEffect(() => {
    if (!target || !detail) return
    const next = revealLine(detail, reveals, target.line)

    if (next !== reveals) {
      store.setDiffReveals(termKey, tabId, next)

      return
    }

    if (scrolled.current === target.nonce) return
    const el = codeRef.current?.querySelector(`[data-line="${target.line}"]`)

    if (!el) return
    scrolled.current = target.nonce
    el.scrollIntoView?.({ block: 'center' })
  }, [target, detail, reveals, rows, mode, store, termKey, tabId])

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
            against={pull && ws ? `#${pull.number} vs ${baseLabel(pull, ws.prs)}` : null}
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
                data-language={detail.language ?? 'plain'}
                ref={codeRef}
              >
                <DiffLines
                  mode={mode}
                  rows={rows}
                  split={split}
                  comments={comments}
                  target={target?.line ?? null}
                  onReveal={onReveal}
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
