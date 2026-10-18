import { describe, expect, it } from 'vitest'
import { EventBus } from './bus'

describe('EventBus', () => {
  it('calls handlers in subscription order, onAny subscribers included', () => {
    const bus = new EventBus()
    const seen: string[] = []

    bus.on('workspace.removed', ({ id }) => seen.push(`first ${id}`))
    bus.onAny((event) => seen.push(`any ${event}`))
    bus.on('workspace.removed', ({ id }) => seen.push(`second ${id}`))
    bus.emit('workspace.removed', { id: 'ws_01hzx3k9c2qf' })
    bus.emit('term.killed', { id: 'term_1' })

    expect(seen).toEqual([
      'any workspace.removed',
      'first ws_01hzx3k9c2qf',
      'second ws_01hzx3k9c2qf',
      'any term.killed'
    ])
  })

  it('stops calling a handler after its unsubscribe function runs', () => {
    const bus = new EventBus()
    const seen: string[] = []
    const off = bus.on('term.killed', ({ id }) => seen.push(id))
    const offAny = bus.onAny((event) => seen.push(event))

    bus.emit('term.killed', { id: 'a' })
    off()
    offAny()
    bus.emit('term.killed', { id: 'b' })

    expect(seen).toEqual(['term.killed', 'a'])
  })

  it('logs a handler that throws and still runs the others', () => {
    const logs: string[] = []
    const bus = new EventBus({ log: (m) => logs.push(m) })
    const seen: string[] = []

    bus.on('term.killed', () => {
      throw new Error('boom')
    })
    bus.on('term.killed', ({ id }) => seen.push(id))
    bus.emit('term.killed', { id: 'a' })

    expect(seen).toEqual(['a'])
    expect(logs).toEqual(['event term.killed handler threw: boom'])
  })
})
