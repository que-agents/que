import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeBackgroundTask, makeWorkspace } from '../testing/fixtures'
import { MIGRATIONS, Store } from './store'

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

describe('migrations', () => {
  it('drops the retired task queue from a database the previous release wrote, keeping its workspaces', () => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'que-store-'))
    const path = join(dir, 'que.db')
    const previous = new DatabaseSync(path)
    previous.exec('CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')

    MIGRATIONS.slice(0, -1).forEach((sql, i) => {
      previous.exec(sql)
      previous
        .prepare('INSERT INTO migrations (version, applied_at) VALUES (?, ?)')
        .run(i + 1, '2026-10-19T21:00:00.000Z')
    })

    previous.exec(`
      INSERT INTO projects (id, name, path, default_branch, created_at)
        VALUES ('prj_01hzw7q2m4nb', 'uploader', '/Users/dev/src/uploader', 'main', '2026-10-13T21:00:00.000Z');
      INSERT INTO workspaces (id, project_id, name, branch, path, base_ref, status, status_at, created_at)
        VALUES ('ws_01hzx3k9c2qf', 'prj_01hzw7q2m4nb', 'APP-1432-retry-logic', 'APP-1432-retry-logic',
          '/Users/dev/.que/worktrees/uploader/APP-1432-retry-logic', 'main', 'idle',
          '2026-10-13T21:05:00.000Z', '2026-10-13T21:05:00.000Z');
      INSERT INTO tasks (id, project_id, workspace_id, title, brief, source, state, max_turns,
          max_budget_usd, pr_url, created_at, updated_at)
        VALUES ('task-01hzy8m3p5rd', 'prj_01hzw7q2m4nb', 'ws_01hzx3k9c2qf', 'Retry uploads on 503',
          'Retry uploads on 503 with backoff', 'prompt', 'done', 40, 5,
          'https://github.com/rquellh/uploader/pull/12', '2026-10-13T21:10:00.000Z',
          '2026-10-14T03:00:00.000Z');
      INSERT INTO kv (key, value) VALUES
        ('queue.open', '1'),
        ('queue.opened_at', '2026-10-13T22:00:00.000Z'),
        ('concurrency', '3'),
        ('tickets.last_sync_at', '2026-10-14T08:00:00.000Z');
    `)

    previous.close()

    const reopened = new Store(path)

    const tasksTable = reopened.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`)
      .get()

    const kept = {
      workspace: reopened.getWorkspace('ws_01hzx3k9c2qf')?.name,
      queueOpen: reopened.getKv('queue.open'),
      queueOpenedAt: reopened.getKv('queue.opened_at'),
      concurrency: reopened.getKv('concurrency'),
      lastSync: reopened.getKv('tickets.last_sync_at')
    }

    reopened.close()
    fs.rmSync(dir, { recursive: true, force: true })

    expect(tasksTable).toBeUndefined()
    expect(kept).toEqual({
      workspace: 'APP-1432-retry-logic',
      queueOpen: undefined,
      queueOpenedAt: undefined,
      concurrency: undefined,
      lastSync: '2026-10-14T08:00:00.000Z'
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
  it('reads a title source a retired release wrote as unset', () => {
    const ws = makeWorkspace({ title: 'Retry logic for the uploader', titleSource: 'brief' })
    store.insertWorkspace(ws)
    store.db.exec(`UPDATE workspaces SET title_source = 'summary'`)

    const read = store.getWorkspace(ws.id)

    expect(read).toMatchObject({ title: 'Retry logic for the uploader' })
    expect(read?.titleSource).toBeUndefined()
  })

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
