import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeBackgroundTask, makeTask, makeWorkspace } from '../testing/fixtures'
import { Store } from './store'

let store: Store

beforeEach(() => {
  store = new Store(':memory:')
  store.insertProject({
    id: 'prj_01hzw7q2m4nb',
    name: 'uploader',
    path: '/Users/dev/src/uploader',
    defaultBranch: 'main',
    createdAt: '2026-10-13T21:00:00.000Z'
  })
})

afterEach(() => {
  store.close()
})

describe('tasks', () => {
  it('reads back every field it wrote, after an insert and after an update', () => {
    const task = makeTask({ title: 'Retry uploads on 503', maxBudgetUsd: 2.5 })

    store.insertTask(task)

    expect(store.getTask(task.id)).toStrictEqual(task)

    const updated = {
      ...task,
      state: 'done' as const,
      reason: 'no_changes',
      sessionId: 'sess_8f2c1d',
      pid: 48213,
      attempts: 2,
      costUsd: 1.37,
      turns: 14,
      permissionMode: 'acceptEdits',
      branch: 'que/retry-uploads-on-503',
      prUrl: 'https://example.test/pr/42',
      resultText: 'Added backoff.',
      startedAt: '2026-10-13T21:06:00.000Z',
      finishedAt: '2026-10-13T21:40:00.000Z',
      updatedAt: '2026-10-13T21:40:00.000Z'
    }

    store.updateTask(updated)

    expect(store.getTask(task.id)).toStrictEqual(updated)
    expect(Object.keys(store.listTasks(['done'])[0])).toEqual(Object.keys(task))
  })

  it('counts tasks by state, zero for the states with none', () => {
    store.insertTask(makeTask({ state: 'queued' }))
    store.insertTask(makeTask({ state: 'queued' }))
    store.insertTask(makeTask({ state: 'running' }))

    expect(store.countTasksByState()).toEqual({
      queued: 2,
      preparing: 0,
      running: 1,
      paused: 0,
      finishing: 0,
      done: 0,
      stuck: 0,
      failed: 0,
      stopped: 0
    })
  })
})

describe('hook events', () => {
  it('keeps the newest 500 per workspace and leaves other workspaces alone', () => {
    for (let i = 0; i < 503; i++) {
      store.insertHookEvent(
        'ws_01hzx3k9c2qf',
        null,
        'PostToolUse',
        { i },
        '2026-10-13T21:05:00.000Z'
      )
    }

    store.insertHookEvent('ws_01hzx7m1p0aa', null, 'Stop', {}, '2026-10-13T21:05:00.000Z')

    const kept = store.listHookEvents('ws_01hzx3k9c2qf')

    expect(kept).toHaveLength(500)
    expect(JSON.parse(kept[0].payload)).toEqual({ i: 3 })
    expect(JSON.parse(kept[499].payload)).toEqual({ i: 502 })
    expect(store.listHookEvents('ws_01hzx7m1p0aa')).toHaveLength(1)
  })
})

describe('workspaces', () => {
  it('lists the ids of unarchived workspaces with a stored status', () => {
    const working = makeWorkspace({ status: 'working' })
    const idle = makeWorkspace({ status: 'idle' })
    const archived = makeWorkspace({ status: 'working', archivedAt: '2026-10-13T22:00:00.000Z' })

    for (const w of [working, idle, archived]) store.insertWorkspace(w)

    expect(store.listWorkspaceIdsByStatus('working')).toEqual([working.id])
  })

  it('reads back the background tasks a status update wrote, and none after an empty one', () => {
    const ws = makeWorkspace({ status: 'working' })
    store.insertWorkspace(ws)

    const update = {
      status: 'working' as const,
      reason: null,
      at: '2026-10-20T14:02:00.000Z',
      lastActivityAt: '2026-10-20T14:02:00.000Z',
      sessionId: 'sess_9d41c7'
    }

    const tasks = [
      makeBackgroundTask({ kind: 'subagent', description: 'Explore the repo' }),
      makeBackgroundTask()
    ]

    expect(store.getWorkspace(ws.id)?.backgroundTasks).toEqual([])

    store.updateStatus(ws.id, { ...update, backgroundTasks: tasks })

    expect(store.getWorkspace(ws.id)?.backgroundTasks).toEqual(tasks)

    store.updateStatus(ws.id, { ...update, status: 'idle', backgroundTasks: [] })

    expect(store.getWorkspace(ws.id)?.backgroundTasks).toEqual([])
  })

  it.each([
    ['not JSON', '{oops'],
    ['not a list', '{"id":"b1"}'],
    ['a list of malformed entries', '[{"id":"b1"},"b2",null]']
  ])('reads a stored background list that is %s as none', (_label, json) => {
    const ws = makeWorkspace()
    store.insertWorkspace(ws)
    store.db.prepare('UPDATE workspaces SET background_json = ? WHERE id = ?').run(json, ws.id)

    expect(store.getWorkspace(ws.id)?.backgroundTasks).toEqual([])
  })
})
