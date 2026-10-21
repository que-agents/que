import { describe, expect, it } from 'vitest'
import { countLineText } from './count-line'
import { type BoardTally, boardCountItems, boardEmptyLine, boardTally } from './quiet-board'
import type { WorkspaceStatus } from './types'

const at = (h: number, m = 0): string => new Date(2026, 9, 14, h, m).toISOString()

const zero: BoardTally = { stuck: 0, running: 0, waiting: 0, idle: 0 }

const workspace = (id: string, status: WorkspaceStatus, hasTerminal = false) => ({
  id,
  status,
  hasTerminal
})

describe('boardTally', () => {
  it('counts working workspaces as running and stuck ones as stuck', () => {
    const tally = boardTally({
      workspaces: [
        workspace('ws_01hzx3k9c2qf', 'working', true),
        workspace('ws_01hzx4m1p8rt', 'working', true),
        workspace('ws_01hzx5t6y2wa', 'stuck')
      ]
    })

    expect(tally).toEqual({ ...zero, running: 2, stuck: 1 })
  })

  it('counts needs input as waiting, and idle only for workspaces with a live terminal', () => {
    const tally = boardTally({
      workspaces: [
        workspace('ws_01hzx5t6y2wa', 'needs_input'),
        workspace('ws_01hzx6a1b3cd', 'idle', true),
        workspace('ws_01hzx7e4f5gh', 'idle')
      ]
    })

    expect(tally).toEqual({ ...zero, waiting: 1, idle: 1 })
  })
})

describe('boardCountItems', () => {
  it('orders stuck, running, waiting, idle', () => {
    const items = boardCountItems({ stuck: 1, running: 2, waiting: 1, idle: 1 })

    expect(countLineText(items)).toBe('1 stuck · 2 running · 1 waiting · 1 idle')
  })

  it('omits every zero count', () => {
    expect(countLineText(boardCountItems({ ...zero, running: 2 }))).toBe('2 running')
    expect(boardCountItems(zero)).toEqual([])
  })

  it('tones only stuck, and mutes running', () => {
    const items = boardCountItems({ stuck: 1, running: 1, waiting: 1, idle: 1 })

    expect(items.map((i) => [i.label, i.tone])).toEqual([
      ['stuck', 'bad'],
      ['running', 'muted'],
      ['waiting', undefined],
      ['idle', undefined]
    ])
  })
})

describe('boardEmptyLine', () => {
  it('says nothing is running', () => {
    expect(boardEmptyLine({ summaryAt: null })).toBe('nothing running')
  })

  it('adds when the summary arrives', () => {
    expect(boardEmptyLine({ summaryAt: Date.parse(at(7, 0)) })).toBe(
      'nothing running · summary at 07:00'
    )
  })
})
