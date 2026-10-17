import { describe, expect, it } from 'vitest'
import { countLineText } from './count-line'
import { type BoardTally, boardCountItems, boardEmptyLine, boardTally } from './quiet-board'
import type { TaskState, WorkspaceStatus } from './types'

// Tonight's window started at 19:00 local; the clock reads 02:00.
const since = new Date(2026, 9, 13, 19, 0).getTime()
const at = (h: number, m = 0): string => new Date(2026, 9, h < 12 ? 14 : 13, h, m).toISOString()

const zero: BoardTally = {
  stuck: 0,
  running: 0,
  waiting: 0,
  paused: 0,
  pausedResetsAt: null,
  done: 0,
  idle: 0,
  queued: 0
}

const task = (
  state: TaskState,
  more: { workspaceId?: string | null; pausedUntil?: string | null; updatedAt?: string } = {}
) => ({ workspaceId: null, pausedUntil: null, updatedAt: at(1, 30), state, ...more })

const workspace = (id: string, status: WorkspaceStatus, hasTerminal = false) => ({
  id,
  status,
  hasTerminal
})

describe('boardTally', () => {
  it('counts tonight: live tasks, and finished ones only since the window started', () => {
    const tally = boardTally({
      tasks: [
        task('running'),
        task('queued'),
        task('queued'),
        task('done', { updatedAt: at(23, 10) }),
        task('done', { updatedAt: new Date(2026, 9, 12, 23, 0).toISOString() }),
        task('stuck', { updatedAt: at(0, 40) })
      ],
      workspaces: [],
      sinceMs: since
    })

    expect(tally).toEqual({ ...zero, running: 1, queued: 2, done: 1, stuck: 1 })
  })

  it('counts a working workspace with its running task once, and other working workspaces on top', () => {
    const tally = boardTally({
      tasks: [task('running', { workspaceId: 'ws_01hzx3k9c2qf' })],
      workspaces: [
        workspace('ws_01hzx3k9c2qf', 'working', true),
        workspace('ws_01hzx4m1p8rt', 'working', true)
      ],
      sinceMs: since
    })

    expect(tally.running).toBe(2)
  })

  it('counts a stuck workspace with its stuck task once', () => {
    const tally = boardTally({
      tasks: [task('stuck', { workspaceId: 'ws_01hzx3k9c2qf' })],
      workspaces: [workspace('ws_01hzx3k9c2qf', 'stuck'), workspace('ws_01hzx5t6y2wa', 'stuck')],
      sinceMs: since
    })

    expect(tally.stuck).toBe(2)
  })

  it('counts needs input as waiting, and idle only for workspaces with a live terminal', () => {
    const tally = boardTally({
      tasks: [],
      workspaces: [
        workspace('ws_01hzx5t6y2wa', 'needs_input'),
        workspace('ws_01hzx6a1b3cd', 'idle', true),
        workspace('ws_01hzx7e4f5gh', 'idle')
      ],
      sinceMs: since
    })

    expect(tally).toEqual({ ...zero, waiting: 1, idle: 1 })
  })

  it('takes the earliest rate-limit reset among the paused tasks', () => {
    const tally = boardTally({
      tasks: [
        task('paused', { pausedUntil: at(4, 15) }),
        task('paused', { pausedUntil: at(3, 0) }),
        task('paused')
      ],
      workspaces: [],
      sinceMs: since
    })

    expect(tally.paused).toBe(3)
    expect(tally.pausedResetsAt).toBe(Date.parse(at(3, 0)))
  })
})

describe('boardCountItems', () => {
  it('orders stuck, running, waiting, paused, done, idle', () => {
    const items = boardCountItems({
      stuck: 1,
      running: 2,
      waiting: 1,
      paused: 1,
      pausedResetsAt: Date.parse(at(3, 0)),
      done: 3,
      idle: 1,
      queued: 4
    })

    expect(countLineText(items)).toBe(
      '1 stuck · 2 running · 1 waiting · 1 paused (limit resets 03:00) · 3 done · 1 idle'
    )
  })

  it('omits every zero count, and never lists queued tasks', () => {
    expect(countLineText(boardCountItems({ ...zero, running: 2, done: 3, queued: 2 }))).toBe(
      '2 running · 3 done'
    )
    expect(boardCountItems({ ...zero, queued: 5 })).toEqual([])
  })

  it('tones only stuck, and mutes running', () => {
    const items = boardCountItems({ ...zero, stuck: 1, running: 1, waiting: 1, idle: 1 })

    expect(items.map((i) => [i.label, i.tone])).toEqual([
      ['stuck', 'bad'],
      ['running', 'muted'],
      ['waiting', undefined],
      ['idle', undefined]
    ])
  })

  it('leaves the reset time off a paused count without one', () => {
    expect(countLineText(boardCountItems({ ...zero, paused: 2 }))).toBe('2 paused')
  })
})

describe('boardEmptyLine', () => {
  it('says nothing is running', () => {
    expect(boardEmptyLine({ queued: 0, summaryAt: null })).toBe('nothing running')
  })

  it('adds what is queued for tonight and when the summary arrives', () => {
    expect(boardEmptyLine({ queued: 2, summaryAt: Date.parse(at(7, 0)) })).toBe(
      'nothing running · 2 queued for tonight · summary at 07:00'
    )
  })

  it('leaves out each part that does not apply', () => {
    expect(boardEmptyLine({ queued: 0, summaryAt: Date.parse(at(7, 0)) })).toBe(
      'nothing running · summary at 07:00'
    )
    expect(boardEmptyLine({ queued: 3, summaryAt: null })).toBe(
      'nothing running · 3 queued for tonight'
    )
  })
})
