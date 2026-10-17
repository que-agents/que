import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTask } from '../testing/fixtures'
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
})
