import { memo, useEffect, useMemo } from 'react'
import { GLYPH, lineKind } from '../diff'
import { useQueSelector, useStore } from '../store'

/** A patch's lines, one span each; rebuilt only when the patch text changes. */
const PatchLines = memo(function PatchLines({ patch }: { patch: string }): React.JSX.Element {
  const lines = useMemo(() => patch.replace(/\n$/, '').split('\n'), [patch])

  return (
    <>
      {lines.map((line, i) => (
        // patch lines are static and have no identity
        <span key={i} className="line" data-kind={lineKind(line)}>
          {line || ' '}
        </span>
      ))}
    </>
  )
})

/** One changed file's patch against the workspace's base, as a tab beside the terminals. Read-only. */
export default function DiffView({
  termKey,
  path
}: {
  termKey: string
  path: string
}): React.JSX.Element {
  const store = useStore()
  const entry = useQueSelector((s) => s.diffs[termKey])
  const diff = entry?.data ?? null
  const error = entry?.error ?? null
  const file = diff?.files.find((f) => f.path === path)

  useEffect(() => {
    void store.ensureDiff(termKey)
  }, [store, termKey])

  return (
    <section
      className="diff"
      data-testid="diff-view"
      data-path={path}
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
            <span className={`diff-status tone-${GLYPH[file.status].tone}`}>
              {GLYPH[file.status].label}
            </span>
          </header>
          <pre className="changes-patch diff-patch" data-testid="diff-patch">
            {file.patch == null ? (
              'Binary or too large to show.'
            ) : (
              <PatchLines key={file.path} patch={file.patch} />
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
