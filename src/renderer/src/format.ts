// Pure display rules for the renderer: badge labels and tones. Money and durations are in shared/format.
import type { CheckState, PullRequest, ReviewState, WorkspaceStatus } from '../../preload/index.d'
import { prUrlNumber } from '../../shared/pr-url'

export type Tone = 'neutral' | 'busy' | 'attention' | 'bad' | 'good' | 'muted'

const STATUS: Record<WorkspaceStatus, { label: string; tone: Tone }> = {
  preparing: { label: 'preparing', tone: 'muted' },
  idle: { label: 'idle', tone: 'neutral' },
  working: { label: 'working', tone: 'busy' },
  needs_input: { label: 'needs input', tone: 'attention' },
  stuck: { label: 'stuck', tone: 'bad' },
  exited: { label: 'exited', tone: 'muted' },
  removing: { label: 'removing', tone: 'muted' }
}

export function statusBadge(status: WorkspaceStatus): { label: string; tone: Tone } {
  return STATUS[status]
}

/** The words for a review decision, or for one review in a conversation. */
export const REVIEW_TEXT: Record<ReviewState | NonNullable<PullRequest['review']>, string> = {
  approved: 'approved',
  changes_requested: 'changes requested',
  review_required: 'review required',
  commented: 'commented',
  dismissed: 'dismissed',
  pending: 'pending'
}

const REVIEW_TONE: Record<ReviewState, Tone> = {
  approved: 'good',
  changes_requested: 'bad',
  commented: 'neutral',
  dismissed: 'muted',
  pending: 'attention'
}

/** One review in a conversation: its words and tone. */
export function reviewBadge(state: ReviewState) {
  return { label: REVIEW_TEXT[state], tone: REVIEW_TONE[state] }
}

/** A check run's tone. */
export const CHECK_TONE: Record<CheckState, Tone> = {
  passing: 'good',
  failing: 'bad',
  pending: 'busy',
  skipped: 'muted'
}

/** A pull request's dot: a hollow ring for a draft, its checks' tone while open, muted once settled. */
export type PrDot = Tone | 'ring'

export function prDot(pr: PullRequest): PrDot {
  if (pr.state === 'draft') return 'ring'

  if (pr.state !== 'open') return 'muted'

  return pr.checks === 'none' ? 'neutral' : CHECK_TONE[pr.checks]
}

/**
 * The checks on a pull request row's second line, skipped runs left out: `✗ <first failing> ·
 * 6/7`, else `running 4/7` while any run, else `✓ 7/7`, counting the passing ones, in the tone
 * of the state that decided it. Null without runs.
 */
export function checksLine(pr: PullRequest): { tone: Tone; text: string } | null {
  const runs = pr.checkRuns.filter((c) => c.state !== 'skipped')

  if (runs.length === 0) return null
  const passed = `${runs.filter((c) => c.state === 'passing').length}/${runs.length}`
  const failing = runs.find((c) => c.state === 'failing')

  if (failing) return { tone: CHECK_TONE.failing, text: `✗ ${failing.name} · ${passed}` }

  if (runs.some((c) => c.state === 'pending')) {
    return { tone: CHECK_TONE.pending, text: `running ${passed}` }
  }

  return { tone: CHECK_TONE.passing, text: `✓ ${passed}` }
}

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
