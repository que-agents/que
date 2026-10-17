import { describe, expect, it } from 'vitest'
import { makeStreamResult } from '../testing/fixtures'
import { decodeStreamEvent } from './stream-json.decode'

const SESSION = '5f0c1d2e-0000-4000-8000-9a8b7c6d5e4f'

// Lines as tests/fakes/bin/claude writes them (it mirrors the real stream).
const INIT_LINE = {
  type: 'system',
  subtype: 'init',
  cwd: '/Users/dev/.que/worktrees/uploader/APP-1432-retry-logic',
  session_id: SESSION,
  tools: ['Bash', 'Edit', 'Read', 'Write'],
  mcp_servers: [],
  model: 'claude-sonnet-4-5',
  permissionMode: 'acceptEdits',
  slash_commands: ['compact', 'context', 'cost', 'init', 'review'],
  apiKeySource: 'none',
  claude_code_version: '2.1.0',
  output_style: 'default',
  agents: ['general-purpose'],
  skills: [],
  plugins: [],
  uuid: '0b7c2f4e-1111-4000-8000-5a6b7c8d9e0f'
}

const assistantLine = (content: object[]) => ({
  type: 'assistant',
  message: {
    id: 'msg_4f1e2d3c4b5a69788796a5b4',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
    content,
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 48, cache_read_input_tokens: 0 }
  },
  parent_tool_use_id: null,
  session_id: SESSION,
  uuid: '1c8d3a5f-2222-4000-8000-6b7c8d9e0f1a'
})

const RATE_LIMIT_LINE = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'rejected',
    resetsAt: 1_792_000_000,
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
    isUsingOverage: false
  },
  session_id: SESSION,
  uuid: '2d9e4b6a-3333-4000-8000-7c8d9e0f1a2b'
}

const API_RETRY_LINE = {
  type: 'system',
  subtype: 'api_retry',
  attempt: 1,
  max_retries: 10,
  retry_delay_ms: 30000,
  error_status: 429,
  error: 'rate_limit',
  session_id: SESSION,
  uuid: '3eaf5c7b-4444-4000-8000-8d9e0f1a2b3c'
}

describe('decodeStreamEvent', () => {
  it('decodes the init line to the session id', () => {
    expect(decodeStreamEvent(INIT_LINE)).toEqual({ kind: 'init', sessionId: SESSION })
  })

  it('joins the text blocks of an assistant turn, skipping tool calls', () => {
    const line = assistantLine([
      { type: 'text', text: "I'll make that change now." },
      { type: 'tool_use', id: 'toolu_01', name: 'Write', input: {} },
      { type: 'text', text: 'Done.' }
    ])

    expect(decodeStreamEvent(line)).toEqual({
      kind: 'assistant',
      text: "I'll make that change now.\nDone."
    })
  })

  it('gives a tool-only assistant turn no text', () => {
    const line = assistantLine([{ type: 'tool_use', id: 'toolu_02', name: 'Bash', input: {} }])

    expect(decodeStreamEvent(line)).toEqual({ kind: 'assistant', text: null })
  })

  it('decodes a result line to cost, turns, session and final text', () => {
    expect(decodeStreamEvent(makeStreamResult())).toEqual({
      kind: 'result',
      subtype: 'success',
      costUsd: 0.74,
      turns: 9,
      sessionId: 'sess_8c1d2e',
      text: 'Added exponential backoff to the uploader and covered it with tests.',
      startupFailed: false
    })
  })

  it('treats an empty final text as none and flags a startup failure', () => {
    const line = makeStreamResult({
      subtype: 'error_during_execution',
      is_error: true,
      result: '',
      startup_failure_reason: 'worktree_refused'
    })

    expect(decodeStreamEvent(line)).toMatchObject({
      kind: 'result',
      subtype: 'error_during_execution',
      text: undefined,
      startupFailed: true
    })
  })

  it('decodes an api_retry line to its HTTP status and delay', () => {
    expect(decodeStreamEvent(API_RETRY_LINE)).toEqual({
      kind: 'api_retry',
      httpStatus: 429,
      retryDelayMs: 30_000
    })
  })

  it('decodes a rate_limit_event with its reset time in epoch ms', () => {
    expect(decodeStreamEvent(RATE_LIMIT_LINE)).toEqual({
      kind: 'rate_limit',
      status: 'rejected',
      resetsAt: 1_792_000_000_000
    })
  })

  it('keeps any other typed line as a sign of life', () => {
    expect(decodeStreamEvent({ type: 'system', subtype: 'hook_response', exit_code: 0 })).toEqual({
      kind: 'other',
      type: 'system'
    })
    expect(decodeStreamEvent({ type: 'user', message: { role: 'user', content: [] } })).toEqual({
      kind: 'other',
      type: 'user'
    })
  })

  it.each([
    ['an array', [1, 2]],
    ['an object without a type', { no_type: true }],
    ['a non-string type', { type: 7 }],
    ['an init without a session id', { type: 'system', subtype: 'init' }],
    ['a result without a subtype', { type: 'result', num_turns: 3 }],
    ['an assistant line without content', { type: 'assistant', message: {} }],
    ['a rate_limit_event without its info', { type: 'rate_limit_event' }]
  ])('drops %s', (_name, line) => {
    expect(decodeStreamEvent(line)).toBeNull()
  })
})
