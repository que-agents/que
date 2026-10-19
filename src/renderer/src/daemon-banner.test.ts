import { describe, expect, it } from 'vitest'
import { makeWorkspace } from '@renderer/testing/fixtures'
import { daemonBannerText, restartCost } from './daemon-banner'
import type { TermTab } from './store'

const LEAD =
  'que was updated. The background service is still running the previous build. Restart it to pick up the changes.'

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

describe('daemonBannerText', () => {
  it.each([
    [{ terminals: 1, working: 0 }, 'This ends 1 terminal.'],
    [{ terminals: 1, working: 1 }, 'This ends 1 terminal (1 working).'],
    [{ terminals: 3, working: 0 }, 'This ends 3 terminals.'],
    [{ terminals: 3, working: 2 }, 'This ends 3 terminals (2 working).'],
    [{ terminals: 0, working: 0 }, 'No terminals are running.']
  ])('names the cost of %j', (cost, tail) => {
    expect(daemonBannerText(cost)).toBe(`${LEAD} ${tail}`)
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
