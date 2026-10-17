import { describe, expect, it } from 'vitest'
import { decodeAgents } from './status.decode'

describe('decodeAgents', () => {
  it('reads a bare list of agents', () => {
    expect(
      decodeAgents([{ cwd: '/Users/dev/que-worktrees/APP-1432-retry-logic', status: 'Waiting' }])
    ).toEqual([{ cwd: '/Users/dev/que-worktrees/APP-1432-retry-logic', status: 'Waiting' }])
  })

  it('reads the list under agents', () => {
    expect(decodeAgents({ agents: [{ cwd: '/Users/dev/que-worktrees/uploader' }] })).toEqual([
      { cwd: '/Users/dev/que-worktrees/uploader' }
    ])
  })

  it('drops entries that are not objects and fields that are not strings', () => {
    expect(decodeAgents([null, 7, { cwd: 42, status: 'running' }])).toEqual([{ status: 'running' }])
  })

  it('is null for output that holds no list', () => {
    expect(decodeAgents(null)).toBeNull()
    expect(decodeAgents({ agents: 'none' })).toBeNull()
    expect(decodeAgents('[]')).toBeNull()
  })
})
