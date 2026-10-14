import { describe, expect, it } from 'vitest'
import { cleanSpawnEnv } from './env'

describe('cleanSpawnEnv', () => {
  it('drops the markers a running agent session leaves in its shells', () => {
    const env = cleanSpawnEnv({
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SESSION_ID: '7d0c5b2a-0000-4000-8000-3e4f5a6b7c8d',
      CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/claude-502/inbox.sock',
      CLAUDE_CODE_MESSAGING_TOKEN: 'tok_41b2',
      CLAUDE_PID: '48213',
      HOME: '/Users/dev'
    })

    expect(Object.keys(env).sort()).toEqual(['HOME', 'QUE_TERMINAL'])
  })

  it("keeps the user's own agent configuration", () => {
    const kept = {
      CLAUDE_CONFIG_DIR: '/Users/dev/.claude-work',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'true',
      CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1',
      ANTHROPIC_API_KEY: 'sk-ant-test-0000',
      GH_TOKEN: 'gho_test',
      PATH: '/usr/bin:/bin'
    }

    expect(cleanSpawnEnv({ ...kept, CLAUDECODE: '1' })).toEqual({ ...kept, QUE_TERMINAL: '1' })
  })

  it("drops the launching emulator's identity so programs pick generic terminal features", () => {
    const env = cleanSpawnEnv({
      TERM: 'xterm-kitty',
      TERM_PROGRAM: 'kitty',
      TERM_PROGRAM_VERSION: '0.42.0',
      TERM_SESSION_ID: 'w0t1p0:4B9C',
      TERM_THEME: 'dark',
      KITTY_WINDOW_ID: '3',
      KITTY_PID: '812',
      ITERM_SESSION_ID: 'w0t0p0',
      GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty.app/Contents/Resources',
      WEZTERM_PANE: '0',
      VSCODE_INJECTION: '1',
      TMUX: '/tmp/tmux-502/default,1234,0',
      TMUX_PANE: '%0',
      WINDOWID: '1',
      COLORTERM: 'truecolor',
      LANG: 'en_US.UTF-8'
    })

    // TERM itself is the PTY host's to set; the identity around it goes.
    expect(Object.keys(env).sort()).toEqual(['COLORTERM', 'LANG', 'QUE_TERMINAL', 'TERM'])
  })

  it('drops app internals and skips unset values', () => {
    const env = cleanSpawnEnv({
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
      ELECTRON_ENABLE_LOGGING: '1',
      SHELL: '/bin/zsh',
      UNSET: undefined
    })

    expect(env).toEqual({ SHELL: '/bin/zsh', QUE_TERMINAL: '1' })
  })

  it('marks the result as a que terminal and leaves the input untouched', () => {
    const base = { HOME: '/Users/dev', CLAUDECODE: '1' }

    const env = cleanSpawnEnv(base)

    expect(env.QUE_TERMINAL).toBe('1')
    expect(base).toEqual({ HOME: '/Users/dev', CLAUDECODE: '1' })
  })
})
