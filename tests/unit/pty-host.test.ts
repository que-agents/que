import { afterEach, describe, expect, it } from 'vitest'
import { PtyHost } from '../../src/daemon/pty-host'

const host = new PtyHost()
afterEach(() => host.killAll())

describe('PtyHost', () => {
  it('mirrors PTY output into the headless terminal', async () => {
    let exited: number | null = null
    host.onExit((_id, info) => (exited = info.exitCode))
    const t = host.create({ file: '/bin/sh', args: ['-c', 'printf "hello\\n"'], cols: 80, rows: 24 })
    expect(t.info().alive).toBe(true)

    const deadline = Date.now() + 5000
    let snap = await t.snapshot()
    while (!snap.text.includes('hello') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
      snap = await t.snapshot()
    }
    expect(snap.text).toContain('hello')
    expect(snap.serialized.length).toBeGreaterThan(0)
    expect(snap.serialized).toContain('hello')

    while (exited === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    expect(exited).toBe(0)
    expect(t.info().alive).toBe(false)
  })

  it('resizes the PTY and mirror together', () => {
    const t = host.create({ file: '/bin/sh', args: ['-c', 'sleep 5'], cols: 80, rows: 24 })
    t.resize(100, 30)
    expect(t.info()).toMatchObject({ cols: 100, rows: 30 })
    expect(t.mirror.cols).toBe(100)
    expect(host.kill(t.id)).toBe(true)
    expect(host.get(t.id)).toBeUndefined()
  })
})
