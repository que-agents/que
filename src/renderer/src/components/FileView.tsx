import { memo, useEffect, useMemo } from 'react'
import { fileKey, useQue, useStore } from '../store'

/** A file's lines, numbered, one span each; rebuilt only when the text changes. */
const FileLines = memo(function FileLines({
  lines
}: {
  lines: readonly string[]
}): React.JSX.Element {
  return (
    <>
      {lines.map((line, i) => (
        // a file's lines are static and have no identity
        <span key={i} className="line">
          <span className="ln" aria-hidden="true">
            {i + 1}
          </span>
          {line}
        </span>
      ))}
    </>
  )
})

/** One file of the worktree as a tab beside the terminals, read-only, with line numbers. */
export default function FileView({
  termKey,
  path
}: {
  termKey: string
  path: string
}): React.JSX.Element {
  const store = useStore()
  const { fileContents } = useQue()
  const entry = fileContents[fileKey(termKey, path)]
  const file = entry?.data
  const error = entry?.error ?? null

  useEffect(() => {
    void store.ensureFile(termKey, path)
  }, [store, termKey, path])

  const content = file?.content
  const lines = useMemo(() => content?.replace(/\n$/, '').split('\n') ?? [], [content])
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
            <FileLines lines={lines} />
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
