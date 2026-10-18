// The steps of a handoff as the daemon handing over sees them, as a pure
// reducer: each input moves the handoff on and names the effects to run. What
// a failure leaves running depends only on how far the handoff got:
//
//   adopting   the successor is taking the fds; this daemon still serves.
//              A failure resumes reading here and answers with the error.
//   releasing  this daemon is closing its socket and services for the
//              successor. A failure also listens again and restarts them.
//   binding    the successor is binding the socket. A failure is handled as
//              in releasing: the successor is stopped and this daemon serves.
//   ready      the successor serves; this daemon answers and exits, leaving
//              every terminal, the socket and the pid file to it.
//   failed     this daemon serves with its terminals as before.
//
// Ready and failed are final: a late message from the successor changes nothing.

export type HandoffPhase = 'adopting' | 'releasing' | 'binding' | 'ready' | 'failed'

export interface HandoffState {
  phase: HandoffPhase
  /** The successor's pid once it is ready. */
  pid?: number
  /** Why it failed, once it has. */
  error?: string
}

export type HandoffInput =
  /** The successor holds every fd and has rebuilt its terminals. */
  | { type: 'adopted' }
  /** This daemon has stopped serving and removed its socket. */
  | { type: 'released' }
  /** The successor serves the socket. */
  | { type: 'ready'; pid: number }
  | { type: 'failed'; error: string }
  | { type: 'timeout' }
  /** The successor process ended. */
  | { type: 'exited'; code: number | null }

export type HandoffEffect =
  /** Stop serving (all but the caller's connection) and remove the socket. */
  | 'release'
  /** Tell the successor to bind the socket. */
  | 'bind'
  /** SIGKILL the successor, so it runs no shutdown that would end the terminals. */
  | 'kill-successor'
  /** Serve the socket again, with fresh services. */
  | 'relisten'
  /** Read the terminals again. */
  | 'resume'
  /** Answer the caller, then exit without ending any terminal. */
  | 'reply-ok'
  | 'reply-error'

export interface HandoffStep {
  state: HandoffState
  effects: HandoffEffect[]
}

export const initialHandoff: HandoffState = { phase: 'adopting' }

export function stepHandoff(state: HandoffState, input: HandoffInput): HandoffStep {
  const stay: HandoffStep = { state, effects: [] }

  if (state.phase === 'ready' || state.phase === 'failed') return stay

  if (input.type === 'failed' || input.type === 'timeout' || input.type === 'exited') {
    const error = failure(state.phase, input)
    const released = state.phase !== 'adopting'

    return {
      state: { phase: 'failed', error },
      effects: released
        ? ['kill-successor', 'relisten', 'resume', 'reply-error']
        : ['kill-successor', 'resume', 'reply-error']
    }
  }

  if (state.phase === 'adopting' && input.type === 'adopted') {
    return { state: { phase: 'releasing' }, effects: ['release'] }
  }

  if (state.phase === 'releasing' && input.type === 'released') {
    return { state: { phase: 'binding' }, effects: ['bind'] }
  }

  if (state.phase === 'binding' && input.type === 'ready') {
    return { state: { phase: 'ready', pid: input.pid }, effects: ['reply-ok'] }
  }

  // Out of order (a second adopted, ready before bind): ignored.
  return stay
}

function failure(
  phase: HandoffPhase,
  input: Extract<HandoffInput, { type: 'failed' | 'timeout' | 'exited' }>
): string {
  const step = phase === 'adopting' ? 'taking over the terminals' : 'binding the socket'

  if (input.type === 'failed') return `the new daemon failed while ${step}: ${input.error}`

  if (input.type === 'timeout') return `the new daemon did not answer while ${step}`

  return `the new daemon exited (code ${input.code ?? 'none'}) while ${step}`
}
