import { useEffect } from 'react'
import { useQue, useStore } from '../store'

/** One file of the worktree as a tab beside the terminals, read-only, with line numbers. */
export default function FileView({
  termKey,
  path
}: {
  termKey: string
  path: string
}): React.JSX.Element {
  const store = useStore()
  const { fileContents, fileErrors } = useQue()
  const contents = fileContents[termKey]
  const file = contents && path in contents ? contents[path] : undefined
  const error = fileErrors[termKey]?.[path] ?? null

  useEffect(() => {
    void store.ensureFile(termKey, path)
  }, [store, termKey, path])

  const lines = file?.content?.replace(/\n$/, '').split('\n') ?? []
  const digits = String(Math.max(lines.length, 1)).length

  return (
    <section
      className="diff file"
      data-testid="file-view"
      data-path={path}
      aria-label={`File ${path}`}
    >
      <header className="diff-header" data-testid="file-header">
        <span className="file-path" title={path}>
          {path}
        </span>
      </header>
      {error ? (
        <p className="form-error changes-error" role="alert" data-testid="file-error">
          {error}
        </p>
      ) : file === undefined ? (
        <p className="changes-note" data-testid="file-loading">
          Loading…
        </p>
      ) : file === null ? (
        <p className="changes-note" data-testid="file-missing">
          No such file
        </p>
      ) : file.binary || file.content === null ? (
        <p className="changes-note" data-testid="file-binary">
          Binary file · {Math.max(1, Math.round(file.size / 1024)).toLocaleString('en-US')} KB
        </p>
      ) : (
        <>
          <pre
            className="file-text"
            data-testid="file-text"
            style={{ '--ln-width': `${digits}ch` } as React.CSSProperties}
          >
            {lines.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a file's lines are static and have no identity
              <span key={i} className="line">
                <span className="ln" aria-hidden="true">
                  {i + 1}
                </span>
                {line}
              </span>
            ))}
          </pre>
          {file.truncated && (
            <p className="changes-note file-truncated" data-testid="file-truncated">
              Showing the first 500,000 characters
            </p>
          )}
        </>
      )}
    </section>
  )
}
