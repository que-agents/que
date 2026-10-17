import { describe, expect, it } from 'vitest'
import { makeHookEvent } from '../testing/fixtures'
import { decodeHookEvent } from './hook.decode'

const SESSION = '7d0c5b2a-0000-4000-8000-3e4f5a6b7c8d'
const CWD = '/Users/dev/.que/worktrees/uploader/APP-1432-retry-logic'
const TRANSCRIPT = `/Users/dev/.claude/projects/-Users-dev--que-worktrees-uploader-APP-1432-retry-logic/${SESSION}.jsonl`

// The common fields every hook payload carries, as tests/fakes/bin/claude writes them.
const common = {
  session_id: SESSION,
  transcript_path: TRANSCRIPT,
  cwd: CWD,
  permission_mode: 'acceptEdits'
}

describe('decodeHookEvent', () => {
  it('decodes a Notification payload with its per-event fields', () => {
    const raw = {
      ...common,
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'Claude needs your permission to use Bash',
      title: 'Permission needed'
    }

    expect(decodeHookEvent(raw)).toEqual(raw)
  })

  it('decodes a fixture payload unchanged', () => {
    const raw = makeHookEvent('StopFailure', {
      error: 'rate_limit',
      error_details: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}'
    })

    expect(decodeHookEvent(raw)).toEqual(raw)
  })

  it('keeps tool input and response, and drops fields it does not know', () => {
    const raw = {
      ...common,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { stdout: 'ok', exit_code: 0 },
      tool_use_id: 'toolu_01',
      duration_ms: 812
    }

    expect(decodeHookEvent(raw)).toEqual({
      ...common,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { stdout: 'ok', exit_code: 0 },
      tool_use_id: 'toolu_01'
    })
  })

  it('drops an optional field of the wrong type', () => {
    expect(
      decodeHookEvent({ ...common, hook_event_name: 'Notification', notification_type: 3 })
    ).toEqual({ ...common, hook_event_name: 'Notification' })
  })

  it.each([
    ['null', null],
    ['an array', [common]],
    ['an unknown event name', { ...common, hook_event_name: 'Teleport' }],
    ['a payload without an event name', common],
    [
      'a payload without a transcript path',
      { ...common, hook_event_name: 'Stop', transcript_path: undefined }
    ],
    ['a non-string session id', { ...common, hook_event_name: 'Stop', session_id: 42 }]
  ])('drops %s', (_name, raw) => {
    expect(decodeHookEvent(raw)).toBeNull()
  })
})
