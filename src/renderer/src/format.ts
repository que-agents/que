// Pure display rules for the renderer: badge labels and tones. Money and durations are in shared/format.
import type { PullRequest, WorkspaceStatus } from '../../preload/index.d'
import { prUrlNumber } from '../../shared/pr-url'

export type Tone = 'neutral' | 'busy' | 'attention' | 'bad' | 'good' | 'muted'

const STATUS: Record<WorkspaceStatus, { label: string; tone: Tone }> = {
  preparing: { label: 'preparing', tone: 'muted' },
  idle: { label: 'idle', tone: 'neutral' },
  working: { label: 'working', tone: 'busy' },
  needs_input: { label: 'needs input', tone: 'attention' },
  stuck: { label: 'stuck', tone: 'bad' },
  exited: { label: 'exited', tone: 'muted' }
}

export function statusBadge(status: WorkspaceStatus): { label: string; tone: Tone } {
  return STATUS[status]
}

const REVIEW_TEXT = {
  approved: 'approved',
  changes_requested: 'changes requested',
  review_required: 'review required'
} as const

/** A pull request's tone and the words the workspace card writes for it, from one ladder. */
function prTone(pr: PullRequest): [Tone, string] {
  if (pr.state === 'merged') return ['good', 'merged']

  if (pr.state === 'closed') return ['muted', 'closed']

  if (pr.checks === 'failing') return ['bad', `${pr.state} · checks failing`]

  if (pr.review === 'changes_requested') return ['attention', REVIEW_TEXT.changes_requested]

  if (pr.state === 'draft') return ['neutral', 'draft']
  const plain = pr.checks === 'none' ? pr.state : `${pr.state} · checks ${pr.checks}`

  if (pr.review === 'approved' && (pr.checks === 'passing' || pr.checks === 'none'))
    return ['good', plain]

  return ['busy', plain]
}

/**
 * The chip for a pull request: `#41`, a tone, a tooltip sentence, and the card's words for
 * its state (`text`).
 */
export function prBadge(pr: PullRequest) {
  const [tone, text] = prTone(pr)
  const parts: string[] = [pr.state]

  if (pr.checks !== 'none') parts.push(`checks ${pr.checks}`)

  if (pr.review) parts.push(REVIEW_TEXT[pr.review])

  return { label: `#${pr.number}`, tone, text, title: `PR #${pr.number}: ${parts.join(', ')}` }
}

/** A pull request's number from its URL (`…/pull/<n>`); undefined without a URL. */
export function prNumberOf(prUrl: string | null | undefined): string | undefined {
  const n = prUrlNumber(prUrl)

  return n === null ? undefined : String(n)
}

/** What a tab or session row calls a terminal: its program, the name until the daemon knows it. */
export function tabLabel(t: { name: string; process?: string }): string {
  return t.process ?? t.name
}
