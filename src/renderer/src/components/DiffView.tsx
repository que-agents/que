import { memo, useEffect, useMemo, useRef } from 'react'
import type { PrThreadEntry } from '../../../preload/index.d'
import { formatAge } from '../../../shared/format'
import { GLYPH, lineKind, newLineNumbers } from '../diff'
import { baseLabel } from '../pr-list'
import { prDiffId, prKey, useQueSelector, useStore } from '../store'
import { useNow } from '../useNow'

const NO_COMMENTS: readonly PrThreadEntry[] = []

/** A line comment under its line: who and when, then what it says. */
function LineComment({ entry }: { entry: PrThreadEntry }): React.JSX.Element {
  const now = useNow()

  return (
    <span className="line-comment" data-testid={`diff-comment-${entry.id}`}>
      <span className="line-comment-who">
        {entry.author} · {formatAge(entry.at, now, ' ago')}
      </span>
      <span className="line-comment-body">{entry.body}</span>
    </span>
  )
}

/**
 * A patch's lines, one span each, with each line's number in the new file in `data-line`; a
 * line comment shows under the line it is on. Rebuilt only when the patch or comments change.
 */
const PatchLines = memo(function PatchLines({
  patch,
  comments,
  target
}: {
  patch: string
  comments: readonly PrThreadEntry[]
  target: number | null
}): React.JSX.Element {
  const lines = useMemo(() => patch.replace(/\n$/, '').split('\n'), [patch])
  const numbers = useMemo(() => newLineNumbers(patch), [patch])

  return (
    <>
      {lines.map((line, i) => {
        const n = numbers[i]
        const here = n === null ? NO_COMMENTS : comments.filter((c) => c.line === n)

        return (
          // patch lines are static and have no identity
          <span key={i} className="line-group">
            <span
              className="line"
              data-kind={lineKind(line)}
              data-line={n ?? undefined}
              data-target={n !== null && n === target ? true : undefined}
            >
              {line || ' '}
            </span>
            {here.map((c) => (
              <LineComment key={c.id} entry={c} />
            ))}
          </span>
        )
      })}
    </>
  )
})

/**
 * One changed file's patch as a tab beside the terminals. Read-only. Without `pr`, the
 * workspace's diff against its base; with it, that pull request's own diff against its base,
 * headed `#188 vs #187`, with its line comments under their lines.
 */
export default function DiffView({
  termKey,
  path,
  pr: number
}: {
  termKey: string
  path: string
  pr?: number
}): React.JSX.Element {
  const store = useStore()
  const inPr = number !== undefined
  const k = inPr ? prKey(termKey, number) : termKey
  const entry = useQueSelector((s) => (inPr ? s.prDiffs[k] : s.diffs[k]))
  const thread = useQueSelector((s) => (inPr ? s.prThreads[k]?.data : undefined))
  const ws = useQueSelector((s) => s.workspaces[termKey])

  const target = useQueSelector((s) =>
    inPr ? s.diffTargets[`${termKey}\0${prDiffId(number, path)}`] : undefined
  )

  const diff = entry?.data ?? null
  const error = entry?.error ?? null
  const file = diff?.files.find((f) => f.path === path)
  const pull = inPr ? ws?.prs.find((p) => p.number === number) : undefined
  const patchRef = useRef<HTMLPreElement>(null)

  const comments = useMemo(
    () =>
      (thread?.entries ?? []).filter(
        (e: PrThreadEntry) => e.kind === 'line' && e.path === path && e.line !== null
      ),
    [thread, path]
  )

  useEffect(() => {
    if (number === undefined) void store.ensureDiff(termKey)
    else {
      void store.ensurePrDiff(termKey, number)
      void store.ensurePrThread(termKey, number)
    }
  }, [store, termKey, number])

  // A line comment asked for a line: bring it into view each time it asks.
  const patch = file?.patch
  useEffect(() => {
    if (!target || patch == null) return
    const el = patchRef.current?.querySelector(`[data-line="${target.line}"]`)
    el?.scrollIntoView?.({ block: 'center' })
  }, [target, patch])

  return (
    <section
      className="diff"
      data-testid="diff-view"
      data-path={path}
      data-pr={number}
      aria-label={`Diff of ${path}`}
    >
      {error && (
        <p className="form-error changes-error" role="alert" data-testid="diff-error">
          {error}
        </p>
      )}
      {file ? (
        <>
          <header className="diff-header" data-testid="diff-header">
            <span className="diff-path" title={file.path}>
              {`${file.from ? `${file.from} → ${file.path}` : file.path} · +${file.additions} −${file.deletions}`}
            </span>
            {pull && ws && (
              <span className="diff-against" data-testid="diff-against">
                #{pull.number} vs {baseLabel(pull, ws.prs)}
              </span>
            )}
            <span className={`diff-status tone-${GLYPH[file.status].tone}`}>
              {GLYPH[file.status].label}
            </span>
          </header>
          <pre className="changes-patch diff-patch" data-testid="diff-patch" ref={patchRef}>
            {file.patch == null ? (
              'Binary or too large to show.'
            ) : (
              <PatchLines
                key={file.path}
                patch={file.patch}
                comments={comments}
                target={target?.line ?? null}
              />
            )}
          </pre>
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
