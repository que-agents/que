import { useCallback, useEffect, useRef, useState } from 'react'
import { GLYPH } from '../diff'
import { formatAge } from '../../../shared/format'
import { diffId, usePanes, useQueSelector } from '../store'
import { useNow } from '../useNow'
import Menu, { type MenuItem } from './Menu'

/**
 * A workspace's changed files against its base, in the review pane: `[ CHANGES ]` with the
 * totals, then `commits n ▾ · vs base ▾ · k uncommitted`. Clicking a file (or Enter on the
 * cursor's) opens its diff as a tab beside the terminals. `commits n` narrows the files to one
 * commit, and `vs base` picks the ref they are compared against.
 */
export default function ChangesList({ termKey }: { termKey: string }): React.JSX.Element {
  const store = usePanes(termKey)
  const entry = useQueSelector((s) => s.diffs[termKey])
  const scope = useQueSelector((s) => s.diffScopes[termKey])
  const diff = entry?.data ?? null
  const error = entry?.error ?? null
  const files = diff?.files ?? []
  const activeId = store.paneActiveId(termKey, store.focusedPane(termKey))
  const [cursor, setCursor] = useState(0)
  const [menu, setMenu] = useState<'commits' | 'base' | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const commitsButton = useRef<HTMLButtonElement>(null)
  const baseButton = useRef<HTMLButtonElement>(null)
  const chosen = scope?.commit ?? null
  const chosenCommit = chosen ? diff?.commits.find((c) => c.sha === chosen) : undefined

  const toggleMenu = (which: 'commits' | 'base'): void =>
    setMenu((m) => (m === which ? null : which))

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
  const dirty = files.filter((f) => f.dirty).length

  const now = useNow()

  const commitItems: MenuItem[] = [
    {
      label: 'All commits',
      testId: 'all',
      selected: chosen === null,
      action: () => void store.setDiffCommit(termKey, null)
    },
    ...(diff?.commits ?? []).map((c) => ({
      label: `${c.shortSha} ${c.subject} · ${formatAge(c.at, now, ' ago')}`,
      title: `${c.subject} (${c.author})`,
      testId: c.sha,
      selected: c.sha === chosen,
      action: () => void store.setDiffCommit(termKey, c.sha)
    }))
  ]

  const baseItems: MenuItem[] = (diff?.bases ?? []).map((ref, i) => ({
    label: ref,
    testId: `option-${i}`,
    dataRef: ref,
    selected: ref === diff?.base,
    action: () => void store.setDiffBase(termKey, ref)
  }))

  return (
    <section className="changes" data-testid="changes-list" aria-label="Changes">
      <header className="review-head">
        <h2 className="label">[ Changes ]</h2>
        {diff && (
          <span
            className="review-sum"
            data-testid="changes-totals"
            title={`${diff.head} vs ${diff.base} · ${diff.commitsAhead} ${
              diff.commitsAhead === 1 ? 'commit' : 'commits'
            } ahead`}
          >
            <span className="add">+{adds}</span> <span className="del">−{dels}</span> ·{' '}
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </span>
        )}
      </header>
      <div className="changes-bar">
        <p className="review-subline" data-testid="changes-summary">
          {diff && (
            <>
              <button
                type="button"
                className="ghost changes-pick"
                ref={commitsButton}
                data-testid="changes-commits-menu"
                aria-haspopup="menu"
                aria-expanded={menu === 'commits'}
                title={chosen ? (chosenCommit?.subject ?? chosen) : undefined}
                onClick={() => toggleMenu('commits')}
              >
                {chosen ? 'commit' : 'commits'}{' '}
                <span className="bright" data-testid="changes-commits">
                  {chosen ? (chosenCommit?.shortSha ?? chosen.slice(0, 7)) : diff.commitsAhead}
                </span>{' '}
                ▾
              </button>
              {' · '}
              <button
                type="button"
                className="ghost changes-pick"
                ref={baseButton}
                data-testid="changes-base-menu"
                aria-haspopup="menu"
                aria-expanded={menu === 'base'}
                onClick={() => toggleMenu('base')}
              >
                vs{' '}
                <span className="bright" data-testid="changes-base">
                  {diff.base}
                </span>{' '}
                ▾
              </button>
              {dirty > 0 && <span data-testid="changes-uncommitted"> · {dirty} uncommitted</span>}
            </>
          )}
        </p>
        {diff && menu === 'commits' && (
          <Menu
            label="Commits"
            testId="changes-commit"
            className="changes-menu"
            items={commitItems}
            anchor={commitsButton}
            onClose={closeMenu}
          />
        )}
        {diff && menu === 'base' && (
          <Menu
            label="Compare against"
            testId="changes-base"
            className="changes-menu"
            items={baseItems}
            anchor={baseButton}
            onClose={closeMenu}
          />
        )}
      </div>
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
                <span className="path" title={f.path}>
                  {f.from ? `${f.from} → ${f.path}` : f.path}
                </span>
                {f.dirty && (
                  <span
                    className="dirty-dot"
                    title="uncommitted"
                    data-testid={`changes-file-${i}-dirty`}
                  />
                )}
                <span className="count">
                  <span className="add">+{f.additions}</span>{' '}
                  <span className="del">−{f.deletions}</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
