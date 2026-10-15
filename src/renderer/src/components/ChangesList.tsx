import { useEffect, useState } from 'react'
import { GLYPH } from '../diff'
import { diffId, useQue, useStore } from '../store'

/**
 * A workspace's changed files against its base, in the review pane. Clicking a
 * file (or Enter on the cursor's) opens its diff as a tab beside the terminals.
 */
export default function ChangesList({ termKey }: { termKey: string }): React.JSX.Element {
  const store = useStore()
  const { connected, diffs, diffErrors, workspaces } = useQue()
  const ws = workspaces[termKey]
  const diff = diffs[termKey] ?? null
  const error = diffErrors[termKey] ?? null
  const files = diff?.files ?? []
  const activeId = store.paneActiveId(termKey, store.focusedPane(termKey))
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    void store.ensureDiff(termKey)
  }, [store, termKey])

  const at = Math.min(cursor, Math.max(files.length - 1, 0))

  const open = (i: number): void => {
    const f = files[i]
    if (!f) return
    setCursor(i)
    store.openDiff(termKey, f.path)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      open(at)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = at + (e.key === 'ArrowDown' ? 1 : -1)
    if (next >= 0 && next < files.length) setCursor(next)
  }

  const adds = files.reduce((n, f) => n + f.additions, 0)
  const dels = files.reduce((n, f) => n + f.deletions, 0)

  return (
    <section className="changes" data-testid="changes-list" aria-label="Changes">
      <header className="changes-bar">
        <p className="changes-summary" data-testid="changes-summary">
          {diff &&
            `${diff.head} vs ${diff.base} · ${diff.commitsAhead} ${
              diff.commitsAhead === 1 ? 'commit' : 'commits'
            } ahead · ${files.length} ${files.length === 1 ? 'file' : 'files'} · +${adds} −${dels}`}
        </p>
        <button
          type="button"
          className="ghost"
          data-testid="changes-refresh"
          disabled={!connected}
          onClick={() => void store.fetchDiff(termKey)}
        >
          Refresh
        </button>
        {ws && (
          <button
            type="button"
            className="ghost"
            data-testid="changes-open-editor"
            disabled={!connected}
            onClick={() => void store.openInEditor(ws.path)}
          >
            Open in editor
          </button>
        )}
      </header>
      {error && (
        <p className="form-error changes-error" role="alert" data-testid="changes-error">
          {error}
        </p>
      )}
      {diff && files.length === 0 && (
        <p className="changes-note" data-testid="changes-empty">
          No changes against {diff.base}.
        </p>
      )}
      {files.length > 0 && (
        <div
          className="changes-files"
          role="listbox"
          aria-label="Changed files"
          tabIndex={0}
          data-testid="changes-files"
          onKeyDown={onKeyDown}
        >
          {files.map((f, i) => {
            const g = GLYPH[f.status]
            return (
              <div
                key={f.path}
                role="option"
                tabIndex={-1}
                aria-selected={i === at}
                className="changes-file"
                data-testid={`changes-file-${i}`}
                data-path={f.path}
                data-active={activeId === diffId(f.path)}
                onClick={() => open(i)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  e.stopPropagation()
                  open(i)
                }}
              >
                <span className={`glyph tone-${g.tone}`} title={g.label}>
                  {g.glyph}
                </span>
                {f.dirty && (
                  <span className="dirty" title="uncommitted">
                    *
                  </span>
                )}
                <span className="path" title={f.path}>
                  {f.from ? `${f.from} → ${f.path}` : f.path}
                </span>
                <span className="count">
                  +{f.additions} −{f.deletions}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
