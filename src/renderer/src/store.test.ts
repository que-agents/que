import { afterEach, describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'
import { fakeBridge } from '@renderer/testing/fake-bridge'
import { makeTermInfo } from '@renderer/testing/fixtures'
import { QueStore } from './store'

const shell = makeTermInfo({ name: 'zsh', cwd: '/Users/dev/code/uploader' })
const session = makeTermInfo({ name: 'zsh', cwd: '/Users/dev/code/api', process: 'zsh' })

let store: QueStore | null = null

afterEach(() => {
  store?.stop()
  store = null
})

async function started(): Promise<QueStore> {
  fakeBridge.seedTerminal(shell)
  fakeBridge.seedTerminal(session)
  const s = new QueStore(window.que)
  store = s
  s.start()
  await waitFor(() => {
    expect(s.getState().terminals.map((t) => t.id)).toEqual(
      expect.arrayContaining([shell.id, session.id])
    )
  })

  return s
}

describe('QueStore terminals', () => {
  describe('term.updated', () => {
    it("replaces the terminal's title and process and leaves the other tabs as they were", async () => {
      const s = await started()
      const before = s.getState().terminals
      const other = before.find((t) => t.id === shell.id)

      fakeBridge.updateTerminal(session.id, { title: '✳ Retry the uploader', process: 'claude' })

      await waitFor(() => {
        expect(s.getState().terminals.find((t) => t.id === session.id)).toMatchObject({
          title: '✳ Retry the uploader',
          process: 'claude'
        })
      })
      expect(s.getState().terminals.find((t) => t.id === shell.id)).toBe(other)
    })

    it('keeps the same terminals array when neither field changed', async () => {
      const s = await started()
      fakeBridge.updateTerminal(session.id, { title: '✳ Retry the uploader', process: 'claude' })
      await waitFor(() => {
        expect(s.getState().terminals.find((t) => t.id === session.id)?.process).toBe('claude')
      })
      const before = s.getState().terminals

      fakeBridge.updateTerminal(session.id, { title: '✳ Retry the uploader', process: 'claude' })

      expect(s.getState().terminals).toBe(before)
    })
  })
})

describe('QueStore usage', () => {
  const at = new Date(2026, 9, 27, 14, 8).getTime()

  const reading = {
    fiveHour: { pct: 42, resetsAt: new Date(2026, 9, 27, 16, 20).getTime() },
    sevenDay: { pct: 18, resetsAt: new Date(2026, 10, 2, 9, 0).getTime() },
    at,
    workspaceId: 'ws_01hzx3k9c2qf'
  }

  it('loads the reading at start, then follows usage.changed', async () => {
    fakeBridge.setUsage(reading)
    const s = await started()
    await waitFor(() => {
      expect(s.getState().usage).toEqual(reading)
    })

    const newer = { ...reading, fiveHour: { ...reading.fiveHour, pct: 57 }, at: at + 60_000 }
    fakeBridge.setUsage(newer)

    await waitFor(() => {
      expect(s.getState().usage).toEqual(newer)
    })
  })

  it('is null before the first reading and after every window resets', async () => {
    const s = await started()
    expect(s.getState().usage).toBeNull()

    fakeBridge.setUsage(reading)
    await waitFor(() => {
      expect(s.getState().usage).toEqual(reading)
    })
    fakeBridge.setUsage(null)

    await waitFor(() => {
      expect(s.getState().usage).toBeNull()
    })
  })
})
