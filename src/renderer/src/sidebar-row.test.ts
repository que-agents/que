import { describe, expect, it } from 'vitest'
import { makeBackgroundTask, makeTask, makeWorkspace } from '@renderer/testing/fixtures'
import { minutesAgo } from '@renderer/testing/helpers'
import { hoverWord, rowTone, unseenDone } from './sidebar-row'

const NOW = new Date(2026, 9, 17, 21, 30).getTime()

const idle = makeWorkspace({ id: 'ws_01hzx3k9c2qf', name: 'app-1432-retry-logic' })
const fresh = { ...idle, finishedAt: minutesAgo(NOW, 12), seenAt: minutesAgo(NOW, 40) }

const devServer = makeBackgroundTask({ since: minutesAgo(NOW, 31) })

const logTail = makeBackgroundTask({
  kind: 'monitor',
  description: 'tail -f logs/api.log',
  since: minutesAgo(NOW, 18)
})

const explorer = makeBackgroundTask({
  kind: 'subagent',
  description: 'Explore the repo',
  since: minutesAgo(NOW, 2)
})

describe('rowTone', () => {
  describe('the workspace status', () => {
    it('reads an idle workspace looked at as a grey dot and a faint name', () => {
      expect(
        rowTone({ ...idle, finishedAt: minutesAgo(NOW, 40), seenAt: minutesAgo(NOW, 12) })
      ).toEqual({
        status: 'idle',
        tone: 'neutral',
        working: false,
        unseen: false,
        weight: 'faint',
        background: []
      })
    })

    it('gives a working workspace the working mark and the secondary weight', () => {
      expect(rowTone({ ...idle, status: 'working' })).toMatchObject({
        status: 'working',
        working: true,
        weight: 'secondary'
      })
    })

    it('puts needs input and stuck at full strength, each in its tone', () => {
      expect(rowTone({ ...idle, status: 'needs_input' })).toMatchObject({
        tone: 'attention',
        weight: 'fg'
      })
      expect(rowTone({ ...idle, status: 'stuck' })).toMatchObject({ tone: 'bad', weight: 'fg' })
    })

    it('reads an exited workspace faint, told apart by its muted dot', () => {
      expect(rowTone({ ...idle, status: 'exited' })).toMatchObject({
        tone: 'muted',
        weight: 'faint'
      })
    })
  })

  describe('finished, not looked at', () => {
    it('is green with a full-strength name', () => {
      expect(rowTone(fresh)).toEqual({
        status: 'idle',
        tone: 'good',
        working: false,
        unseen: true,
        weight: 'fg',
        background: []
      })
    })

    it('is looked at while selected: its own tone, at full strength', () => {
      expect(rowTone(fresh, undefined, true)).toMatchObject({
        tone: 'neutral',
        unseen: false,
        weight: 'fg'
      })
    })

    it('leaves working, needs input and stuck to their own tones', () => {
      expect(rowTone({ ...fresh, status: 'working' })).toMatchObject({ unseen: false })
      expect(rowTone({ ...fresh, status: 'needs_input' })).toMatchObject({
        tone: 'attention',
        unseen: false
      })
      expect(rowTone({ ...fresh, status: 'stuck' })).toMatchObject({ tone: 'bad', unseen: false })
    })
  })

  describe('a task in the workspace', () => {
    it('speaks for the workspace while live: the mark while active, a dot while queued or paused', () => {
      const ws = { ...idle, status: 'exited' as const }

      expect(rowTone(ws, makeTask({ workspaceId: ws.id, state: 'running' }))).toEqual({
        status: 'running',
        tone: 'busy',
        working: true,
        unseen: false,
        weight: 'secondary',
        background: []
      })
      expect(rowTone(ws, makeTask({ workspaceId: ws.id, state: 'queued' }))).toMatchObject({
        status: 'queued',
        tone: 'neutral',
        working: false
      })
      expect(rowTone(ws, makeTask({ workspaceId: ws.id, state: 'paused' }))).toMatchObject({
        tone: 'attention',
        working: false
      })
    })

    it('reports done once finished, green until looked at, then the workspace tone', () => {
      const done = makeTask({
        workspaceId: idle.id,
        state: 'done',
        finishedAt: minutesAgo(NOW, 12)
      })

      const ws = { ...fresh, status: 'exited' as const }

      expect(rowTone(ws, done)).toMatchObject({ status: 'done', tone: 'good', unseen: true })
      expect(rowTone({ ...ws, seenAt: minutesAgo(NOW, 1) }, done)).toMatchObject({
        status: 'done',
        tone: 'muted',
        unseen: false,
        weight: 'faint'
      })
    })

    it('gives way to an interactive session in the same workspace', () => {
      const done = makeTask({ workspaceId: idle.id, state: 'done' })

      expect(rowTone({ ...idle, status: 'needs_input' }, done).status).toBe('needs_input')
    })
  })

  describe('background tasks', () => {
    it('marks an idle row with a background shell', () => {
      expect(rowTone({ ...idle, backgroundTasks: [devServer] })).toMatchObject({
        status: 'idle',
        working: false,
        background: ['shell']
      })
      expect(rowTone(idle).background).toEqual([])
    })

    it('marks an unseen finish too, beside its green dot', () => {
      expect(rowTone({ ...fresh, backgroundTasks: [devServer] })).toMatchObject({
        tone: 'good',
        unseen: true,
        background: ['shell']
      })
    })

    it('leaves the mark off while working, needing input, or running a live task', () => {
      const running = makeTask({ workspaceId: idle.id, state: 'running' })

      expect(
        rowTone({ ...idle, status: 'working', backgroundTasks: [explorer, devServer] }).background
      ).toEqual([])
      expect(
        rowTone({ ...idle, status: 'needs_input', backgroundTasks: [devServer] }).background
      ).toEqual([])
      expect(rowTone({ ...idle, backgroundTasks: [devServer] }, running).background).toEqual([])
    })
  })
})

describe('hoverWord', () => {
  it('names the background kinds of an idle row, each once, in the daemon order', () => {
    const shell = { ...idle, backgroundTasks: [devServer] }

    const both = {
      ...idle,
      backgroundTasks: [devServer, logTail, makeBackgroundTask()]
    }

    expect(hoverWord(shell, undefined, rowTone(shell), NOW)).toEqual({
      word: 'idle · shell',
      tone: null
    })
    expect(hoverWord(both, undefined, rowTone(both), NOW).word).toBe('idle · shell · monitor')
  })

  it('keeps the unseen finish word over the background kinds', () => {
    const ws = { ...fresh, backgroundTasks: [devServer] }

    expect(hoverWord(ws, undefined, rowTone(ws), NOW).word).toBe('done · 12m ago')
  })

  it('says the status, toned only for needs input and stuck', () => {
    const working = { ...idle, status: 'working' as const }
    const asking = { ...idle, status: 'needs_input' as const }
    const stuck = { ...idle, status: 'stuck' as const }

    expect(hoverWord(working, undefined, rowTone(working), NOW)).toEqual({
      word: 'working',
      tone: null
    })
    expect(hoverWord(asking, undefined, rowTone(asking), NOW)).toEqual({
      word: 'needs input',
      tone: 'attention'
    })
    expect(hoverWord(stuck, undefined, rowTone(stuck), NOW)).toEqual({ word: 'stuck', tone: 'bad' })
  })

  it('says how long ago an unseen finish was', () => {
    expect(hoverWord(fresh, undefined, rowTone(fresh), NOW)).toEqual({
      word: 'done · 12m ago',
      tone: null
    })
  })

  it("names the finished task's ask: its draft pull request, or that it changed nothing", () => {
    const ws = { ...fresh, status: 'exited' as const }

    const withPr = makeTask({
      workspaceId: ws.id,
      state: 'done',
      finishedAt: fresh.finishedAt,
      prUrl: 'https://github.com/rquellh/que/pull/12'
    })

    const nothing = makeTask({
      workspaceId: ws.id,
      state: 'done',
      reason: 'no_changes',
      finishedAt: fresh.finishedAt
    })

    expect(hoverWord(ws, withPr, rowTone(ws, withPr), NOW).word).toBe('done · draft PR #12')
    expect(hoverWord(ws, nothing, rowTone(ws, nothing), NOW).word).toBe('done · no changes')
  })

  it('falls back to the age when a turn ended after the task did', () => {
    const later = makeTask({
      workspaceId: fresh.id,
      state: 'done',
      finishedAt: minutesAgo(NOW, 90),
      prUrl: 'https://github.com/rquellh/que/pull/12'
    })

    expect(hoverWord(fresh, later, rowTone(fresh, later), NOW).word).toBe('done · 12m ago')
  })

  it("says a live task's state, and done for a finished one already looked at", () => {
    const running = makeTask({ workspaceId: idle.id, state: 'finishing' })
    const done = makeTask({ workspaceId: idle.id, state: 'done' })

    expect(hoverWord(idle, running, rowTone(idle, running), NOW).word).toBe('finishing')
    expect(hoverWord(idle, done, rowTone(idle, done), NOW).word).toBe('done')
  })
})

describe('unseenDone', () => {
  it('is false for a workspace that never finished, seen or not', () => {
    expect(unseenDone(makeWorkspace({ finishedAt: null, seenAt: null }))).toBe(false)
    expect(
      unseenDone(makeWorkspace({ finishedAt: null, seenAt: '2026-10-17T21:10:00.000Z' }))
    ).toBe(false)
  })

  it('is true for a workspace that finished and was never seen', () => {
    expect(
      unseenDone(makeWorkspace({ finishedAt: '2026-10-17T21:12:00.000Z', seenAt: null }))
    ).toBe(true)
  })

  it('is false once seen after it finished', () => {
    expect(
      unseenDone(
        makeWorkspace({
          finishedAt: '2026-10-17T21:12:00.000Z',
          seenAt: '2026-10-17T21:15:30.000Z'
        })
      )
    ).toBe(false)
  })

  it('is true again when it finishes again after it was seen', () => {
    expect(
      unseenDone(
        makeWorkspace({
          finishedAt: '2026-10-17T21:40:00.000Z',
          seenAt: '2026-10-17T21:15:30.000Z'
        })
      )
    ).toBe(true)
  })

  it('is false when it was seen at the moment it finished (selected while it finished)', () => {
    expect(
      unseenDone(
        makeWorkspace({
          finishedAt: '2026-10-17T21:40:00.000Z',
          seenAt: '2026-10-17T21:40:00.000Z'
        })
      )
    ).toBe(false)
  })
})
