// The completion chime: a short generated two-tone (Web Audio, no asset),
// played in work hours only. The player is injectable so tests can count
// chimes without an AudioContext.
import type { ChimeKind, NotificationsConfig, QuietState } from '../../preload/index.d'

export type { ChimeKind }

export interface ChimePlayer {
  play(kind: ChimeKind): void
}

/** The workspace statuses a session's turn can end from. */
const TURN_STATES: ReadonlySet<string> = new Set(['working', 'needs_input', 'stuck'])

/**
 * Which chime a task or workspace status deserves, if any. Complete (when
 * chime_on_complete) for a task reaching `done`, or a session finishing a
 * turn: a workspace going `idle` from `working`, `needs_input` or `stuck`
 * (`idle` from anything else, or with no previous status, is not a turn
 * ending). Needing input (when chime_on_needs_input) for `needs_input` or a
 * task stuck needing input. Never during quiet hours, unlocked or not, and
 * never before the quiet state and config have loaded.
 */
export function shouldChime(
  event: { state: string; reason?: string | null; prev?: string | null },
  quiet: QuietState | null,
  cfg: NotificationsConfig | undefined
): ChimeKind | null {
  if (!quiet || quiet.inQuietHours || !cfg) return null
  const turnEnded = event.state === 'idle' && TURN_STATES.has(event.prev ?? '')
  if (event.state === 'done' || turnEnded) return cfg.chimeOnComplete ? 'complete' : null
  const needsInput =
    event.state === 'needs_input' || (event.state === 'stuck' && event.reason === 'needs_input')
  if (needsInput) return cfg.chimeOnNeedsInput ? 'needs_input' : null
  return null
}

const TONES: Record<ChimeKind, [number, number]> = {
  complete: [660, 880],
  needs_input: [880, 660]
}

let context: AudioContext | null = null

/** Two short sine tones with a soft attack and release. */
export const webAudioPlayer: ChimePlayer = {
  play(kind) {
    try {
      context ??= new AudioContext()
      const ctx = context
      const start = ctx.currentTime + 0.01
      TONES[kind].forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const t = start + i * 0.14
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(0.18, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
        osc.connect(gain).connect(ctx.destination)
        osc.start(t)
        osc.stop(t + 0.24)
      })
    } catch {
      // No audio device (or no Web Audio): stay silent.
    }
  }
}

let player: ChimePlayer = webAudioPlayer

/** Replaces the player (tests); returns the previous one. */
export function setChimePlayer(p: ChimePlayer): ChimePlayer {
  const prev = player
  player = p
  return prev
}

export function resetChimePlayer(): void {
  player = webAudioPlayer
}

export function chime(kind: ChimeKind): void {
  player.play(kind)
}
