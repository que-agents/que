import { useEffect, useMemo, useState } from 'react'
import type { DiffFile } from '../../../preload/index.d'
import { GLYPH } from '../diff'
import { buildTree, defaultExpanded, flatten, type TreeRow } from '../files'
import { diffId, fileId, useQue, useStore } from '../store'
import { ChevronIcon, EditorIcon, RefreshIcon } from './icons'

const NO_FILES: readonly string[] = []

/**
 * A workspace's files as a tree, in the review pane. A changed file carries its
 * Changes glyph and opens its diff tab; an unchanged one opens a read-only file
 * tab beside the terminals. Directories holding changes start open and show
 * how many changed files sit beneath them.
 */
export default function FilesTree({ termKey }: { termKey: string }): React.JSX.Element {
  const store = useStore()

  const { connected, diffs, fileLists, filesExpanded, workspaces } = useQue()

  const ws = workspaces[termKey]
  const list = fileLists[termKey]?.data ?? null
  const diff = diffs[termKey]?.data ?? null
  const error = fileLists[termKey]?.error ?? null
  const diffError = diffs[termKey]?.error ?? null
  const remembered = filesExpanded[termKey]
  const activeId = store.paneActiveId(termKey, store.focusedPane(termKey))
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    void store.ensureFiles(termKey)
    void store.ensureDiff(termKey)
  }, [store, termKey])

  const changed = useMemo(
    () => new Map<string, DiffFile>((diff?.files ?? []).map((f) => [f.path, f])),
    [diff]
  )

  const listed = list?.files ?? NO_FILES
  const tree = useMemo(() => buildTree(listed, changed), [listed, changed])
  // Until the first load settles, directories with changes are open; after that the clicks stand.
  const settled = list !== null && (diff !== null || diffError !== null)

  const expanded = useMemo(
    () => remembered ?? (settled ? defaultExpanded(tree) : new Set<string>()),
    [remembered, settled, tree]
  )

  useEffect(() => {
    if (remembered === undefined && settled) store.setFilesExpanded(termKey, defaultExpanded(tree))
  }, [store, termKey, remembered, settled, tree])

  const rows = useMemo(() => flatten(tree, expanded), [tree, expanded])
  const at = Math.min(cursor, Math.max(rows.length - 1, 0))

  const setOpen = (path: string, open: boolean): void => {
    const next = new Set(expanded)

    if (open) next.add(path)
    else next.delete(path)
    store.setFilesExpanded(termKey, next)
  }

  const open = (i: number): void => {
    const row = rows[i]

    if (!row) return
    setCursor(i)
    const node = row.node

    if (node.kind === 'dir') setOpen(node.path, !row.open)
    else if (node.change) store.openDiff(termKey, node.path)
    else store.openFile(termKey, node.path)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const row = rows[at]

    if (!row) return
    let next: number | null = null

    switch (e.key) {
      case 'Enter':
        e.preventDefault()
        open(at)

        return
      case 'ArrowDown':
        next = Math.min(at + 1, rows.length - 1)
        break
      case 'ArrowUp':
        next = Math.max(at - 1, 0)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = rows.length - 1
        break
      case 'ArrowRight':
        if (row.node.kind === 'dir' && !row.open) setOpen(row.node.path, true)
        next = at
        break
      case 'ArrowLeft':
        if (row.node.kind === 'dir' && row.open) {
          setOpen(row.node.path, false)
          next = at
        } else {
          next = parentOf(rows, at) ?? at
        }

        break
      default:
        return
    }

    e.preventDefault()
    setCursor(next)
  }

  const count = list?.files.length ?? 0
  const changedCount = diff?.files.length ?? 0

  const title = list
    ? [
        `${count.toLocaleString('en-US')} ${count === 1 ? 'file' : 'files'}`,
        ...(diff ? [`${changedCount} changed`] : []),
        ...(list.truncated ? ['listing cut at 20,000'] : [])
      ].join(' · ')
    : undefined

  return (
    <section className="changes files" data-testid="files" aria-label="Files">
      <header className="changes-bar">
        <p className="changes-summary" data-testid="files-summary" title={title}>
          {list && (
            <>
              Files{' '}
              <span className="muted" data-testid="files-count">
                {count.toLocaleString('en-US')}
              </span>
              {diff && <span className="muted"> · {changedCount} changed</span>}
            </>
          )}
        </p>
        <div className="changes-actions">
          <button
            type="button"
            className="ghost icon"
            aria-label="Refresh"
            title="Refresh"
            data-testid="files-refresh"
            disabled={!connected}
            onClick={() => void store.refreshFiles(termKey)}
          >
            <RefreshIcon />
          </button>
          {ws && (
            <button
              type="button"
              className="ghost icon"
              aria-label="Open in editor"
              title="Open in editor"
              data-testid="files-open-editor"
              disabled={!connected}
              onClick={() => void store.openInEditor(ws.path)}
            >
              <EditorIcon />
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="form-error changes-error" role="alert" data-testid="files-error">
          {error}
        </p>
      )}
      {list && rows.length === 0 && (
        <p className="changes-note" data-testid="files-empty">
          No files.
        </p>
      )}
      {rows.length > 0 && (
        <div
          className="files-tree"
          role="tree"
          aria-label="Files"
          tabIndex={0}
          data-testid="files-tree"
          onKeyDown={onKeyDown}
        >
          {rows.map((row, i) => (
            <Row
              key={`${row.node.kind}:${row.node.path}`}
              row={row}
              index={i}
              cursor={i === at}
              active={
                row.node.kind === 'file' &&
                (activeId === diffId(row.node.path) || activeId === fileId(row.node.path))
              }
              onOpen={() => open(i)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** The row of the nearest directory above a row, one level up. */
function parentOf(rows: readonly TreeRow[], i: number): number | null {
  const level = rows[i]?.level ?? 1

  for (let j = i - 1; j >= 0; j--) if (rows[j].level < level) return j

  return null
}

function Row({
  row,
  index,
  cursor,
  active,
  onOpen
}: {
  row: TreeRow
  index: number
  cursor: boolean
  active: boolean
  onOpen: () => void
}): React.JSX.Element {
  const { node, level } = row
  const dir = node.kind === 'dir'
  const change = node.kind === 'file' ? node.change : null
  const g = change ? GLYPH[change.status] : null

  const tone = dir
    ? 'dir'
    : !change
      ? 'file unchanged'
      : change.status === 'deleted'
        ? 'file deleted'
        : 'file changed'

  const title = change?.from ? `${change.from} → ${node.path}` : node.path

  return (
    // the tree handles the keys for its rows, at its cursor
    <div
      role="treeitem"
      tabIndex={-1}
      aria-level={level}
      aria-selected={cursor}
      aria-expanded={dir ? row.open : undefined}
      className={`files-row ${tone}`}
      style={{ paddingLeft: `${8 + (level - 1) * 12}px` }}
      data-testid={`files-row-${index}`}
      data-path={node.path}
      data-kind={node.kind}
      data-active={dir ? undefined : active}
      onClick={onOpen}
    >
      {dir ? <ChevronIcon open={row.open} /> : <span className="chevron-space" />}
      <span className="name" title={title}>
        {node.name}
      </span>
      {node.kind === 'dir' && node.changed > 0 && (
        <span
          className="tally"
          title={`${node.changed} changed`}
          data-testid={`files-row-${index}-count`}
        >
          {node.changed}
        </span>
      )}
      {g && (
        <span className={`glyph tone-${g.tone}`} title={g.label}>
          {g.glyph}
        </span>
      )}
      {change?.dirty && (
        <span className="dirty" title="uncommitted">
          *
        </span>
      )}
    </div>
  )
}
