// The small pieces the review pane's views share: a status dot, `+a −d` in the diff tones,
// a head's totals, and one changed file's row.
import type { DiffFile, PullRequest } from '../../../preload/index.d'
import { plural } from '../../../shared/format'
import { GLYPH, sumLines } from '../diff'
import { prDot, type PrDot } from '../format'

/** A 5px dot in a tone, or a hollow ring. */
export function Dot({ tone, title }: { tone: PrDot; title?: string }): React.JSX.Element {
  return (
    <span
      className={`pr-dot${tone === 'ring' ? ' ring' : ` tone-${tone}`}`}
      title={title}
      data-dot={tone}
    />
  )
}

/** A pull request's dot: a hollow ring for a draft, else its tone. */
export function PrDotMark({ pr }: { pr: PullRequest }): React.JSX.Element {
  return <Dot tone={prDot(pr)} title={pr.state} />
}

/** Lines added and removed: `+a −d` in the diff tones. */
export function LineCounts({ adds, dels }: { adds: number; dels: number }): React.JSX.Element {
  return (
    <>
      <span className="added">+{adds}</span> <span className="removed">−{dels}</span>
    </>
  )
}

/**
 * The line over the files where only comments changed, after the rest of a list:
 * `comments only · 2 files · +10 −3`, all faint.
 */
export function CommentOnlyLine({
  files,
  testId
}: {
  files: readonly DiffFile[]
  testId: string
}): React.JSX.Element {
  const { adds, dels } = sumLines(files)

  return (
    <div className="changes-comment-only" role="presentation" data-testid={testId}>
      comments only · {plural(files.length, 'file')} · +{adds} −{dels}
    </div>
  )
}

/** A diff's totals for a head: `+a −d · n`, with `files` after the count when asked. */
export function DiffTotals({
  files,
  noun = false
}: {
  files: readonly DiffFile[]
  noun?: boolean
}): React.JSX.Element {
  const { adds, dels } = sumLines(files)
  const unit = noun ? (files.length === 1 ? ' file' : ' files') : ''

  return (
    <>
      <LineCounts adds={adds} dels={dels} /> · {files.length}
      {unit}
    </>
  )
}

/**
 * One changed file in a list of them: its glyph, its path (a rename from where), a dot while
 * uncommitted, and `+a −d`. An option of the list's listbox; a click, Enter or Space opens it.
 */
export function FileRow({
  file,
  testId,
  active,
  selected = false,
  onOpen
}: {
  file: DiffFile
  testId: string
  /** Its diff is the focused pane's tab. */
  active: boolean
  /** The list's keyboard cursor is on it. */
  selected?: boolean
  onOpen: () => void
}): React.JSX.Element {
  const g = GLYPH[file.status]

  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      className="changes-file"
      data-testid={testId}
      data-path={file.path}
      data-active={active}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        onOpen()
      }}
    >
      <span className={`glyph tone-${g.tone}`} title={g.label}>
        {g.glyph}
      </span>
      <span className="path" title={file.path}>
        {file.from ? `${file.from} → ${file.path}` : file.path}
      </span>
      {file.dirty && (
        <span className="dirty-dot" title="uncommitted" data-testid={`${testId}-dirty`} />
      )}
      <span className="count">
        <LineCounts adds={file.additions} dels={file.deletions} />
      </span>
    </div>
  )
}
