import { describe, expect, it } from 'vitest'
import {
  decodePredecessorMessage,
  decodeSnapshot,
  decodeSuccessorMessage,
  encodeSnapshot,
  SNAPSHOT_VERSION,
  type HandoffSnapshot
} from './handoff.decode'

const SNAPSHOT: HandoffSnapshot = {
  version: SNAPSHOT_VERSION,
  from: 48213,
  terminals: [
    {
      id: '3f6c2a1e-8b4d-4c1a-9e2f-5d7a8b9c0d1e',
      name: 'APP-1432-retry-logic',
      cwd: '/Users/dev/.que/worktrees/uploader/app-1432-retry-logic',
      createdAt: '2026-10-18T09:12:44.120Z',
      workspaceId: 'ws_01hzx3k9c2qf',
      pid: 48290,
      cols: 132,
      rows: 41,
      fd: 4,
      serialized: '\u001b[1mbuild ok\u001b[0m\r\n$ '
    },
    {
      id: '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
      name: 'zsh',
      cwd: '/Users/dev',
      createdAt: '2026-10-18T09:15:02.871Z',
      pid: 48377,
      cols: 80,
      rows: 24,
      fd: 5,
      serialized: ''
    }
  ]
}

const withTerminal = (patch: Record<string, unknown>): string =>
  JSON.stringify({ ...SNAPSHOT, terminals: [{ ...SNAPSHOT.terminals[0], ...patch }] })

describe('handoff snapshot', () => {
  describe('round trip', () => {
    it('decodes what it encodes, workspace or not', () => {
      expect(decodeSnapshot(encodeSnapshot(SNAPSHOT))).toEqual(SNAPSHOT)
    })

    it('keeps a terminal without a workspace without one', () => {
      expect(decodeSnapshot(encodeSnapshot(SNAPSHOT)).terminals[1]).not.toHaveProperty(
        'workspaceId'
      )
    })
  })

  describe('errors', () => {
    it('refuses another version', () => {
      expect(() => decodeSnapshot(JSON.stringify({ ...SNAPSHOT, version: 2 }))).toThrow(
        'handoff snapshot version 2 is not 1'
      )
    })

    it('refuses text that is not JSON', () => {
      expect(() => decodeSnapshot('{"version":1,')).toThrow('not JSON')
    })

    it('refuses a terminal with a missing field', () => {
      expect(() => decodeSnapshot(withTerminal({ serialized: undefined }))).toThrow(
        'handoff terminal 0: serialized is missing'
      )
    })

    it('refuses an fd that is stdio or the IPC channel', () => {
      expect(() => decodeSnapshot(withTerminal({ fd: 3 }))).toThrow('fd is missing')
    })

    it('refuses a size that is not a positive integer', () => {
      expect(() => decodeSnapshot(withTerminal({ cols: 0.5 }))).toThrow('cols is missing')
    })

    it('refuses a terminal that is not an object', () => {
      expect(() => decodeSnapshot(JSON.stringify({ ...SNAPSHOT, terminals: ['48290'] }))).toThrow(
        'not an object'
      )
    })
  })
})

describe('handoff messages', () => {
  it('reads what the successor sends', () => {
    expect(decodeSuccessorMessage({ type: 'adopted' })).toEqual({ type: 'adopted' })
    expect(decodeSuccessorMessage({ type: 'ready', pid: 48455 })).toEqual({
      type: 'ready',
      pid: 48455
    })
    expect(decodeSuccessorMessage({ type: 'failed', error: 'EADDRINUSE' })).toEqual({
      type: 'failed',
      error: 'EADDRINUSE'
    })
  })

  it('ignores a ready without a pid and anything unknown', () => {
    expect(decodeSuccessorMessage({ type: 'ready' })).toBeNull()
    expect(decodeSuccessorMessage({ type: 'hello' })).toBeNull()
    expect(decodeSuccessorMessage('adopted')).toBeNull()
  })

  it('reads the bind the predecessor sends, and nothing else', () => {
    expect(decodePredecessorMessage({ type: 'bind' })).toEqual({ type: 'bind' })
    expect(decodePredecessorMessage({ type: 'ready' })).toBeNull()
  })
})
