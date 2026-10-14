// Contract tests against the REAL Claude Code CLI: they pin down the shapes the
// fake in tests/fakes/bin/claude imitates. Opt-in (they spend real money and
// need a logged-in `claude`): run with `npm run test:contract`.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FAKES_BIN } from '../../src/testing/fakes'

const CONTRACT = process.env.QUE_CONTRACT === '1'
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'] as const

interface Run {
  code: number
  stdout: string
  stderr: string
}

function claude(args: string[], opts: { cwd: string; env?: Record<string, string> }): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      'claude',
      args,
      {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        encoding: 'utf8',
        timeout: 170_000,
        maxBuffer: 32 * 1024 * 1024
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, stdout, stderr })
      }
    ).stdin?.end()
  })
}

/** Parses newline-delimited JSON, skipping blank lines. */
function jsonLines(text: string): Record<string, unknown>[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe.skipIf(!CONTRACT)('claude contract', () => {
  let dir: string
  let hookScript: string
  let hookLog: string

  beforeAll(() => {
    // The real binary, never the fake: drop tests/fakes/bin from PATH.
    const path = (process.env.PATH ?? '').split(':').filter((p) => p !== FAKES_BIN)
    vi.stubEnv('PATH', path.join(':'))
    dir = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'que-contract-')))
    hookScript = join(dir, 'record-hook.cjs')
    hookLog = join(dir, 'hooks.jsonl')
    fs.writeFileSync(
      hookScript,
      [
        "const fs = require('node:fs')",
        "let input = ''",
        "process.stdin.on('data', (c) => (input += c))",
        "process.stdin.on('end', () => {",
        '  const entry = { marker: process.env.QUE_CONTRACT_MARKER ?? null, payload: JSON.parse(input) }',
        "  fs.appendFileSync(process.argv[2], JSON.stringify(entry) + '\\n')",
        '})',
        ''
      ].join('\n')
    )
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('prints a semver from --version', async () => {
    const r = await claude(['--version'], { cwd: dir })

    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/\d+\.\d+\.\d+/)
  }, 30_000)

  it('lists agents as a JSON array of { pid, cwd, kind, sessionId, status }', async () => {
    const r = await claude(['agents', '--json'], { cwd: dir })

    expect(r.code).toBe(0)
    const agents = JSON.parse(r.stdout) as unknown
    expect(Array.isArray(agents)).toBe(true)
    for (const agent of agents as Record<string, unknown>[]) {
      expect(Object.keys(agent)).toEqual(
        expect.arrayContaining(['pid', 'cwd', 'kind', 'sessionId', 'status'])
      )
    }
  }, 30_000)

  it('runs headless with stream-json, firing hooks and ending in a result', async () => {
    const marker = `que-contract-${Math.random().toString(36).slice(2, 10)}`
    const command = `'${process.execPath}' '${hookScript}' '${hookLog}'`
    const hooks = Object.fromEntries(
      HOOK_EVENTS.map((event) => [event, [{ hooks: [{ type: 'command', command }] }]])
    )

    const r = await claude(
      [
        '-p',
        'Reply with exactly the word OK and nothing else.',
        '--output-format',
        'stream-json',
        '--verbose',
        '--max-turns',
        '1',
        '--permission-mode',
        'acceptEdits',
        '--permission-prompts',
        'none',
        '--settings',
        JSON.stringify({ hooks })
      ],
      { cwd: dir, env: { QUE_CONTRACT_MARKER: marker } }
    )

    expect(r.code, r.stderr).toBe(0)

    // Hooks: the four lifecycle events, in order, with the common fields and our env.
    const entries = jsonLines(fs.readFileSync(hookLog, 'utf8')) as {
      marker: string | null
      payload: Record<string, unknown>
    }[]
    expect(entries.map((e) => e.payload.hook_event_name)).toEqual([...HOOK_EVENTS])
    for (const { marker: seen, payload } of entries) {
      expect(seen).toBe(marker)
      expect(Object.keys(payload)).toEqual(
        expect.arrayContaining(['hook_event_name', 'session_id', 'cwd', 'transcript_path'])
      )
      expect(payload.cwd).toBe(dir)
    }

    // Stream: system/init first, result/success with the fields que reads.
    const stream = jsonLines(r.stdout)
    expect(stream).toContainEqual(expect.objectContaining({ type: 'system', subtype: 'init' }))
    const result = stream.find((m) => m.type === 'result')
    expect(result).toMatchObject({ subtype: 'success', is_error: false })
    expect(Object.keys(result ?? {})).toEqual(
      expect.arrayContaining([
        'num_turns',
        'total_cost_usd',
        'duration_ms',
        'session_id',
        'stop_reason'
      ])
    )
    expect(new Set(entries.map((e) => e.payload.session_id))).toEqual(new Set([result?.session_id]))
  }, 180_000)
})
