// The environment que hands to the processes it starts: the daemon, every
// terminal, and the tools it runs. Whatever started que (a shell inside another
// terminal, an agent's tool, a dev server) leaves markers behind that would
// make those processes behave as if they were still inside it. They are not.

/**
 * Variables a running coding-agent session sets in the shells it spawns, so a
 * nested run knows it is nested: a terminal of ours must start fresh. User
 * configuration (`CLAUDE_CONFIG_DIR`, provider selectors, limits) is kept.
 */
export const AGENT_SESSION_MARKERS: readonly string[] = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_REMOTE_SESSION_ID',
  'CLAUDE_PID'
]

/**
 * How the terminal emulator that launched que identifies itself. Programs
 * read these to pick keyboard protocols and features of that emulator, which
 * an embedded xterm cannot serve, so que's terminals announce none of them.
 */
export const TERMINAL_IDENTITY: readonly string[] = [
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID',
  'TERM_THEME',
  'TMUX',
  'TMUX_PANE',
  'STY',
  'WINDOWID'
]

/** Emulator-specific variables, by the prefix each emulator uses. */
const TERMINAL_IDENTITY_PREFIX = /^(ITERM|KITTY|GHOSTTY|WEZTERM|ALACRITTY|VSCODE|KONSOLE|WT|TABBY)_/

/** Dev-server and app-process variables that must not leak into user shells. */
const APP_INTERNAL: readonly string[] = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
  'ELECTRON_ENABLE_LOGGING'
]

/**
 * A copy of `base` fit for a process que starts: no agent session markers, no
 * other emulator's identity, no app internals, and `QUE_TERMINAL=1` so shells
 * and scripts can tell they run inside que.
 */
export function cleanSpawnEnv(base: NodeJS.ProcessEnv | Record<string, string> = process.env) {
  const env: Record<string, string> = {}

  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue

    if (AGENT_SESSION_MARKERS.includes(k)) continue

    if (TERMINAL_IDENTITY.includes(k) || TERMINAL_IDENTITY_PREFIX.test(k)) continue

    if (APP_INTERNAL.includes(k)) continue

    // The terminal que was started from is not the terminal of what it starts.
    if (k === 'QUE_TERMINAL_ID') continue
    env[k] = v
  }

  env.QUE_TERMINAL = '1'

  return env
}
