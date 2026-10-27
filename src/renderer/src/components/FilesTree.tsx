import { useEffect, useMemo, useRef, useState } from 'react'
import type { DiffFile } from '../../../preload/index.d'
import { GLYPH } from '../diff'
import { allDirs, buildTree, defaultExpanded, filterPaths, flatten, type TreeRow } from '../files'
import { diffId, fileId, usePanes, useQueSelector } from '../store'
import { ChevronIcon, SearchIcon } from './icons'

const NO_FILES: readonly string[] = []

/**
 * A workspace's files as a tree, in the review pane. A changed file carries its
 * Changes glyph and opens its diff tab; an unchanged one opens a read-only file
 * tab beside the terminals. Directories holding changes start open and show
 * how many changed files sit beneath them. The filter at the top narrows the
 * tree to the matching paths with their folders open; Enter opens the first
 * match, Escape clears it. `focusFilter` changing (⌘F in the pane) focuses it.
 */
export default function FilesTree({
  termKey,
  focusFilter = 0
}: {
  termKey: string
  focusFilter?: number
}): React.JSX.Element {
  const store = usePanes(termKey)
  const [filter, setFilter] = useState('')
  const filterField = useRef<HTMLInputElement>(null)
  const listing = useQueSelector((s) => s.fileLists[termKey])
  const diffed = useQueSelector((s) => s.diffs[termKey])
  const remembered = useQueSelector((s) => s.filesExpanded[termKey])
  const list = listing?.data ?? null
  const diff = diffed?.data ?? null
  const error = listing?.error ?? null
  const diffError = diffed?.error ?? null
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

  useEffect(() => {
    if (focusFilter > 0) filterField.current?.focus()
  }, [focusFilter])

  // While the filter narrows the tree, every folder of a match is open.
  const filtering = filter.trim() !== ''

  const narrowed = useMemo(() => {
    if (!filtering) return null
    const keep = new Set(filterPaths([...listed, ...changed.keys()], filter))
    const kept = new Map([...changed].filter(([p]) => keep.has(p)))

    return buildTree(
      listed.filter((p) => keep.has(p)),
      kept
    )
  }, [filtering, filter, listed, changed])

  const rows = useMemo(
    () => (narrowed ? flatten(narrowed, allDirs(narrowed)) : flatten(tree, expanded)),
    [narrowed, tree, expanded]
  )

  const matches = narrowed ? rows.filter((r) => r.node.kind === 'file').length : 0
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

    if (node.kind === 'dir') {
      if (!narrowed) setOpen(node.path, !row.open)
    } else if (node.change) store.openDiff(termKey, node.path)
    else store.openFile(termKey, node.path)
  }

  const onFilterKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setFilter('')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const first = rows.findIndex((r) => r.node.kind === 'file')

      if (first >= 0) open(first)
    }
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
      <header className="review-head">
        <h2 className="label">[ Files ]</h2>
        <span className="review-sum" data-testid="files-summary" title={title}>
          {list && (
            <>
              <span data-testid="files-count">{count.toLocaleString('en-US')}</span>
              {diff && ` · ${changedCount} changed`}
            </>
          )}
        </span>
      </header>
      <label className="files-filter">
        <SearchIcon />
        <input
          ref={filterField}
          type="text"
          aria-label="Filter files"
          placeholder="Filter"
          spellCheck={false}
          autoComplete="off"
          data-testid="files-filter"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setCursor(0)
          }}
          onKeyDown={onFilterKey}
        />
        {filtering && (
          <span className="files-filter-hint" data-testid="files-filter-hint">
            {matches} {matches === 1 ? 'match' : 'matches'}
            {matches > 0 && ' · ⏎ opens'}
          </span>
        )}
      </label>
      {error && (
        <p className="form-error changes-error" role="alert" data-testid="files-error">
          {error}
        </p>
      )}
      {list && rows.length === 0 && (
        <p className="changes-note" data-testid="files-empty">
          {filtering ? 'No files match.' : 'No files.'}
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
