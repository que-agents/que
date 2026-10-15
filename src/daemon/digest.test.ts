import { describe, expect, it } from 'vitest'
import type { WorkspaceStatus } from '../shared/types'
import { makeWorkspace } from '../testing/fixtures'
import { buildWorkspaceDigest, type StatusLogEntry, sortDigests } from './digest'

const PROJECT = {
  id: 'prj_01hzw7q2m4nb',
  name: 'uploader',
  path: '/Users/dev/code/uploader',
  defaultBranch: 'main',
  createdAt: '2026-10-01T09:00:00.000Z'
}
const SINCE = Date.parse('2026-10-13T22:00:00.000Z')
const NOW = Date.parse('2026-10-14T07:30:00.000Z')
const EXTRAS = { commitsAhead: 3 }

const row = (
  status: WorkspaceStatus,
  at: string,
  reason: string | null = null
): StatusLogEntry => ({
  status,
  reason,
  at
})

describe('buildWorkspaceDigest', () => {
  it('sums 42 minutes of work and counts the two times it asked for input', () => {
    const ws = makeWorkspace({ status: 'idle', statusAt: '2026-10-14T01:00:00.000Z' })
    const log = [
      row('idle', '2026-10-13T21:00:00.000Z'),
      row('working', '2026-10-13T23:00:00.000Z'),
      row('needs_input', '2026-10-13T23:20:00.000Z'),
      row('working', '2026-10-13T23:25:00.000Z'),
      row('needs_input', '2026-10-13T23:40:00.000Z'),
      row('working', '2026-10-13T23:50:00.000Z'),
      row('idle', '2026-10-14T00:02:00.000Z')
    ]

    const digest = buildWorkspaceDigest(ws, PROJECT, log, SINCE, NOW, EXTRAS)

    expect(digest).toMatchObject({
      id: ws.id,
      name: ws.name,
      project: 'uploader',
      branch: ws.branch,
      status: 'idle',
      firstActivityAt: '2026-10-13T23:00:00.000Z',
      lastActivityAt: '2026-10-14T00:02:00.000Z',
      workingMs: (20 + 15 + 12) * 60_000,
      needsInputCount: 2,
      waitingSince: null,
      stuckCount: 0,
      commitsAhead: 3
    })
  })

  it('reports the start of a stretch that is still waiting', () => {
    const ws = makeWorkspace({ status: 'needs_input', statusAt: '2026-10-14T02:10:00.000Z' })
    const log = [
      row('idle', '2026-10-13T21:00:00.000Z'),
      row('working', '2026-10-14T02:00:00.000Z'),
      row('needs_input', '2026-10-14T02:10:00.000Z')
    ]

    const digest = buildWorkspaceDigest(ws, PROJECT, log, SINCE, NOW, EXTRAS)

    expect(digest).toMatchObject({
      needsInputCount: 1,
      waitingSince: '2026-10-14T02:10:00.000Z',
      workingMs: 10 * 60_000
    })
  })

  it('clips time already spent working when the window opened', () => {
    const ws = makeWorkspace({ status: 'idle' })
    const log = [
      row('working', '2026-10-13T20:00:00.000Z'),
      row('idle', '2026-10-13T22:30:00.000Z')
    ]

    const digest = buildWorkspaceDigest(ws, PROJECT, log, SINCE, NOW, EXTRAS)

    expect(digest?.workingMs).toBe(30 * 60_000)
    expect(digest?.firstActivityAt).toBe('2026-10-13T22:30:00.000Z')
    expect(digest?.needsInputCount).toBe(0)
  })

  it('counts a workspace still working to now, and its stalls', () => {
    const ws = makeWorkspace({ status: 'working' })
    const log = [
      row('working', '2026-10-14T06:00:00.000Z'),
      row('stuck', '2026-10-14T06:10:00.000Z', 'no_heartbeat'),
      row('working', '2026-10-14T07:00:00.000Z')
    ]

    const digest = buildWorkspaceDigest(ws, PROJECT, log, SINCE, NOW, EXTRAS)

    expect(digest).toMatchObject({ workingMs: (10 + 30) * 60_000, stuckCount: 1 })
  })

  it('leaves out an idle workspace that did nothing in the window', () => {
    const ws = makeWorkspace({ status: 'idle' })
    const log = [row('idle', '2026-10-13T20:00:00.000Z')]

    expect(buildWorkspaceDigest(ws, PROJECT, log, SINCE, NOW, EXTRAS)).toBeNull()
    expect(buildWorkspaceDigest(ws, PROJECT, [], SINCE, NOW, EXTRAS)).toBeNull()
  })

  it('keeps a workspace that is stuck now even with nothing in the window', () => {
    const ws = makeWorkspace({ status: 'stuck', statusReason: 'setup_failed' })
    const log = [row('stuck', '2026-10-13T20:00:00.000Z', 'setup_failed')]

    const digest = buildWorkspaceDigest(ws, PROJECT, log, SINCE, NOW, EXTRAS)

    expect(digest).toMatchObject({
      status: 'stuck',
      statusReason: 'setup_failed',
      firstActivityAt: null,
      lastActivityAt: null,
      workingMs: 0,
      stuckCount: 0
    })
  })
})

describe('sortDigests', () => {
  it('puts needs input first, then stuck, working, and the rest, newest activity first', () => {
    const make = (name: string, status: WorkspaceStatus, last: string | null) => {
      const ws = makeWorkspace({ name, status })
      const log = last ? [row(status, last)] : [row(status, '2026-10-13T20:00:00.000Z')]
      const d = buildWorkspaceDigest(ws, PROJECT, log, SINCE, NOW, EXTRAS)
      if (!d) throw new Error(`${name} has no digest`)
      return d
    }
    const digests = [
      make('idle-new', 'idle', '2026-10-14T05:00:00.000Z'),
      make('working-old', 'working', '2026-10-14T01:00:00.000Z'),
      make('stuck-quiet', 'stuck', null),
      make('asking', 'needs_input', '2026-10-14T00:00:00.000Z'),
      make('working-new', 'working', '2026-10-14T03:00:00.000Z'),
      make('stuck-recent', 'stuck', '2026-10-14T04:00:00.000Z'),
      make('idle-old', 'idle', '2026-10-14T02:00:00.000Z')
    ]

    expect(sortDigests(digests).map((d) => d.name)).toEqual([
      'asking',
      'stuck-recent',
      'stuck-quiet',
      'working-new',
      'working-old',
      'idle-new',
      'idle-old'
    ])
  })
})
