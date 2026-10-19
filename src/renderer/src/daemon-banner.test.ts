import { describe, expect, it } from 'vitest'
import { makeWorkspace } from '@renderer/testing/fixtures'
import { DAEMON_UPDATE_TEXT, daemonRestartText, restartCost } from './daemon-banner'
import type { TermTab } from './store'

const LEAD =
  'The service could not be updated in place: the new daemon exited (code 3). Restart it instead.'

function tab(id: string, key: string, alive = true): TermTab {
  return {
    id,
    name: 'zsh',
    cwd: '/Users/dev/code/uploader',
    alive,
    reattached: true,
    key,
    createdAt: '2026-10-18T09:00:00.000Z'
  }
}

describe('DAEMON_UPDATE_TEXT', () => {
  it('offers the update in place and says the terminals keep running', () => {
    expect(DAEMON_UPDATE_TEXT).toBe(
      'que was updated. The background service is still running the previous build. Update it to pick up the changes; your terminals keep running.'
    )
  })
})

describe('daemonRestartText', () => {
  it.each([
    [{ terminals: 1, working: 0 }, 'This ends 1 terminal.'],
    [{ terminals: 1, working: 1 }, 'This ends 1 terminal (1 working).'],
    [{ terminals: 3, working: 0 }, 'This ends 3 terminals.'],
    [{ terminals: 3, working: 2 }, 'This ends 3 terminals (2 working).'],
    [{ terminals: 0, working: 0 }, 'No terminals are running.']
  ])('gives the reason and names the cost of %j', (cost, tail) => {
    expect(daemonRestartText('the new daemon exited (code 3)', cost)).toBe(`${LEAD} ${tail}`)
  })

  it('ends the reason with one full stop when it brings its own', () => {
    expect(daemonRestartText('the new daemon exited (code 3).', { terminals: 0, working: 0 })).toBe(
      `${LEAD} No terminals are running.`
    )
  })
})

describe('restartCost', () => {
  it('counts running terminals, and those in a working workspace', () => {
    const working = makeWorkspace({ id: 'ws_01hzx3k9c2qf', status: 'working' })
    const idle = makeWorkspace({ id: 'ws_01hzx4m1p8rt', status: 'idle' })

    const cost = restartCost(
      [
        tab('term_a1', working.id),
        tab('term_a2', working.id),
        tab('term_b1', idle.id),
        tab('term_c1', ''),
        tab('term_a3', working.id, false)
      ],
      { [working.id]: working, [idle.id]: idle }
    )

    expect(cost).toEqual({ terminals: 4, working: 2 })
  })
})
