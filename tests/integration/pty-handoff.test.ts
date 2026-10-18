// The mechanism the daemon handoff rests on, proved on this platform with two
// plain processes: a terminal's master fd, inherited through the stdio array,
// keeps the shell running after the process that opened it exits, can be read,
// written and resized by the process that inherited it, and reports the shell's
// exit as the end of the stream.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pidAlive } from '@shared/process'
import { fakeEnv } from '../fakes/env.cjs'

const DIR = resolve(__dirname, 'pty-handoff')

interface Entry {
  from: 'sender' | 'receiver'
  event: string
  data?: string
  shellPid?: number
  receiverPid?: number
  shellAlive?: boolean
  code?: string
}

let home: string
let logFile: string

function entries(): Entry[] {
  if (!fs.existsSync(logFile)) return []

  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Entry)
}

const received = (): string =>
  entries()
    .filter((e) => e.from === 'receiver' && e.event === 'data')
    .map((e) => e.data)
    .join('')

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'que-pty-handoff-')))
  logFile = join(home, 'handoff.log')
})

afterEach(() => {
  // A receiver or shell left by a failed run is ours to stop, by its pid.
  for (const e of entries()) {
    for (const pid of [e.shellPid, e.receiverPid]) {
      if (pid && pidAlive(pid)) process.kill(pid, 'SIGKILL')
    }
  }

  fs.rmSync(home, { recursive: true, force: true })
})

describe('pty handoff', () => {
  it('keeps the shell running through an inherited master fd after the opener exits', async () => {
    const sender = spawn(
      process.execPath,
      [join(DIR, 'sender.cjs'), join(DIR, 'receiver.cjs'), logFile],
      {
        cwd: home,
        env: { ...process.env, ...fakeEnv(home) },
        stdio: 'ignore'
      }
    )

    const senderExit = new Promise<number | null>((r) => sender.once('exit', (code) => r(code)))

    expect(await senderExit).toBe(0)
    const spawned = entries().find((e) => e.event === 'spawned')
    const shellPid = spawned?.shellPid ?? 0

    expect(shellPid).toBeGreaterThan(0)
    // The output printed while nobody read was waiting in the kernel for the receiver.
    await expect.poll(received, { timeout: 5_000 }).toContain('SECOND-MARK-8e2')
    // The sender is gone, the shell is not, and it got no hangup.
    await expect
      .poll(() => entries().find((e) => e.event === 'sender-gone'), { timeout: 5_000 })
      .toMatchObject({ shellAlive: true })
    // A command typed by the receiver runs, and the resize reached the shell.
    await expect.poll(received, { timeout: 5_000 }).toContain('THIRD-MARK-9f3')
    await expect.poll(received, { timeout: 5_000 }).toMatch(/40 100/)
    expect(entries().find((e) => e.event === 'exiting-shell')).toMatchObject({ shellAlive: true })
    // The shell's exit reaches the receiver as the end of the stream (EOF or EIO).
    await expect
      .poll(() => entries().find((e) => e.event === 'end' || e.event === 'error'), {
        timeout: 5_000
      })
      .toBeDefined()
    expect(entries().some((e) => e.event === 'sighup')).toBe(false)
    expect(received()).not.toContain('FIRST-MARK-7d1')
    await expect.poll(() => pidAlive(shellPid), { timeout: 5_000 }).toBe(false)
  })
})
