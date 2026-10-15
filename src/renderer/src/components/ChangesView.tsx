import { useCallback, useEffect, useState } from 'react'
import type { DiffFile, WorkspaceDiff } from '../../../preload/index.d'
import { useQue, useStore } from '../store'

const GLYPH: Record<DiffFile['status'], { glyph: string; tone: string; label: string }> = {
  added: { glyph: 'A', tone: 'good', label: 'added' },
  modified: { glyph: 'M', tone: 'busy', label: 'modified' },
  deleted: { glyph: 'D', tone: 'bad', label: 'deleted' },
  renamed: { glyph: 'R', tone: 'neutral', label: 'renamed' },
  untracked: { glyph: '?', tone: 'attention', label: 'untracked' }
}

type LineKind = 'added' | 'removed' | 'hunk' | 'header' | 'context'

function lineKind(line: string): LineKind {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('diff --git') || line.startsWith('---') || line.startsWith('+++'))
    return 'header'
  if (line.startsWith('+')) return 'added'
  if (line.startsWith('-')) return 'removed'
  return 'context'
}

/** A workspace's changes against its base, file by file with the patch. Read-only. */
export default function ChangesView({ termKey }: { termKey: string }): React.JSX.Element {
  const store = useStore()
  const { connected } = useQue()
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)

  const load = useCallback(async () => {
    try {
      const d = await store.fetchDiff(termKey)
      setDiff(d)
      setSelected((i) => (i < d.files.length ? i : 0))
      setError(null)
    } catch (err) {
      setDiff(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [store, termKey])

  useEffect(() => {
    void load()
  }, [load])

  const files = diff?.files ?? []
  const file = files[selected] as DiffFile | undefined

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = selected + (e.key === 'ArrowDown' ? 1 : -1)
    if (next >= 0 && next < files.length) setSelected(next)
  }

  const adds = files.reduce((n, f) => n + f.additions, 0)
  const dels = files.reduce((n, f) => n + f.deletions, 0)

  return (
    <section className="changes" data-testid="changes-view" aria-label="Changes">
      <header className="changes-bar">
        <p className="changes-summary" data-testid="changes-summary">
          {diff &&
            `${diff.head} vs ${diff.base} · ${diff.commitsAhead} ${
              diff.commitsAhead === 1 ? 'commit' : 'commits'
            } ahead · ${files.length} ${files.length === 1 ? 'file' : 'files'} · +${adds} −${dels}`}
        </p>
        <button
          type="button"
          data-testid="changes-refresh"
          disabled={!connected}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </header>
      {error && (
        <p className="form-error" role="alert" data-testid="changes-error">
          {error}
        </p>
      )}
      {diff && files.length === 0 && (
        <p className="changes-note" data-testid="changes-empty">
          No changes against {diff.base}.
        </p>
      )}
      {files.length > 0 && (
        <div className="changes-body">
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
                  aria-selected={i === selected}
                  className="changes-file"
                  data-testid={`changes-file-${i}`}
                  onClick={() => setSelected(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelected(i)
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
          <pre className="changes-patch" data-testid="changes-patch">
            {file?.patch == null
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
        </div>
      )}
    </section>
  )
}
