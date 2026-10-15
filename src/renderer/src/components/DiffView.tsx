import { useEffect } from 'react'
import { GLYPH, lineKind } from '../diff'
import { useQue, useStore } from '../store'

/** One changed file's patch against the workspace's base, as a tab beside the terminals. Read-only. */
export default function DiffView({
  termKey,
  path
}: {
  termKey: string
  path: string
}): React.JSX.Element {
  const store = useStore()
  const { diffs, diffErrors } = useQue()
  const diff = diffs[termKey] ?? null
  const error = diffErrors[termKey] ?? null
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
            {file.patch == null
              ? 'Binary or too large to show.'
              : file.patch
                  .replace(/\n$/, '')
                  .split('\n')
                  .map((line, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: patch lines are static and have no identity
                    <span key={`${file.path}:${i}`} className="line" data-kind={lineKind(line)}>
                      {line || ' '}
                    </span>
                  ))}
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
