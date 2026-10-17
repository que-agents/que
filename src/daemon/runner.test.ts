import { describe, expect, it } from 'vitest'
import { makeTask } from '../testing/fixtures'
import { buildClaudeArgs, buildPrompt, SYSTEM_PROMPT } from './runner'

describe('buildPrompt', () => {
  it('is the brief, then the repo instructions, then the repo test command', () => {
    const prompt = buildPrompt(makeTask({ brief: 'Add retry logic to the uploader.\n' }), {
      instructions: 'Follow docs/STYLE.md.',
      test: 'npm test'
    })

    expect(prompt.split('\n\n')).toEqual([
      'Add retry logic to the uploader.',
      'Follow docs/STYLE.md.',
      'Run the test command `npm test` and make it pass.'
    ])
  })

  it('is the brief alone when the repo has no instructions or test command', () => {
    const prompt = buildPrompt(makeTask({ brief: 'Fix the flaky upload test' }), {})

    expect(prompt).toBe('Fix the flaky upload test')
  })
})

describe('SYSTEM_PROMPT', () => {
  it('forbids questions and pushing', () => {
    expect(SYSTEM_PROMPT).toContain('You cannot ask questions. If you are blocked, explain why')
    expect(SYSTEM_PROMPT).toContain('Never push')
  })

  it('holds the definition of done every run shares', () => {
    expect(SYSTEM_PROMPT).toContain('Work only inside the current git worktree')
    expect(SYSTEM_PROMPT).toContain('If the repository has a test command, run it')
    expect(SYSTEM_PROMPT).toContain('Commit your work with a clear message.')
    expect(SYSTEM_PROMPT).toContain('suitable for a pull request description')
  })
})

describe('buildClaudeArgs', () => {
  const base = {
    prompt: 'Add retry logic',
    sessionId: '5f0c1d2e-0000-4000-8000-9a8b7c6d5e4f',
    resume: false,
    permissionMode: 'acceptEdits' as const,
    maxTurns: 40,
    maxBudgetUsd: 2.5,
    systemPromptFile: '/Users/dev/.que/system.md',
    settingsFile: '/Users/dev/.que/hooks.json',
    allowedTools: [] as string[]
  }

  it('runs headless with stream-json, hooks, caps, and a fixed session id', () => {
    expect(buildClaudeArgs(base)).toEqual([
      '-p',
      'Add retry logic',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-hook-events',
      '--session-id',
      '5f0c1d2e-0000-4000-8000-9a8b7c6d5e4f',
      '--permission-mode',
      'acceptEdits',
      '--permission-prompts',
      'none',
      '--max-turns',
      '40',
      '--max-budget-usd',
      '2.5',
      '--append-system-prompt-file',
      '/Users/dev/.que/system.md',
      '--settings',
      '/Users/dev/.que/hooks.json'
    ])
  })

  it('resumes instead of starting a session, and passes allowed tools', () => {
    const args = buildClaudeArgs({
      ...base,
      resume: true,
      allowedTools: ['Bash(npm test)', 'Edit']
    })

    expect(args).not.toContain('--session-id')
    expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2)).toEqual([
      '--resume',
      '5f0c1d2e-0000-4000-8000-9a8b7c6d5e4f'
    ])
    expect(args.slice(-2)).toEqual(['--allowedTools', 'Bash(npm test),Edit'])
  })
})
