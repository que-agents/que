// Sidebar titles from the session's own terminal title, over the real socket:
// the fake claude in a workspace terminal writes `✳ <name>` as Claude Code
// does, and the workspace takes the name as its title while the session is
// live. A title the user set stays, a plain shell's title is ignored, and the
// empty title on exit keeps the label. Reading the raw title is in
// src/shared/session-label.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TermInfo } from '@shared/protocol'
import type { Workspace } from '@shared/types'
import {
  recordEvents,
  runClaude,
  startTestDaemon,
  type TestDaemon,
  waitForStatus
} from '../../src/testing/daemon-harness'
import { makeTempRepo } from '../../src/testing/temp-repo'

let daemon: TestDaemon | undefined

afterEach(async () => {
  await daemon?.close()
  daemon = undefined
})

const LABEL = 'Terminal title parsing'
const BRIEF = 'Raise the upload timeout\n\nThe upload test times out on slow CI runners.'

/** A daemon with one project and a workspace made from `params` (a brief by default). */
async function start(
  params: { title?: string; brief?: string } = { brief: BRIEF }
): Promise<{ d: TestDaemon; ws: Workspace }> {
  const d = await startTestDaemon()
  daemon = d
  const project = await d.client.request('project.add', { path: makeTempRepo(d.home) })

  const ws = await d.client.request('workspace.create', {
    projectId: project.id,
    name: 'app-1432-retry-logic',
    ...params
  })

  await waitForStatus(d, ws.id, 'idle')

  return { d, ws }
}

async function titleOf(
  d: TestDaemon,
  id: string
): Promise<Pick<Workspace, 'title' | 'titleSource'>> {
  const { title, titleSource } = await d.client.request('workspace.get', { id })

  return { title, titleSource }
}

async function term(d: TestDaemon, id: string): Promise<TermInfo | undefined> {
  return (await d.client.request('term.list')).find((t) => t.id === id)
}

/** Waits until the terminal's raw title is `title` (undefined: none). */
async function waitForTermTitle(
  d: TestDaemon,
  id: string,
  title: string | undefined
): Promise<void> {
  await expect.poll(async () => (await term(d, id))?.title, { timeout: 15_000 }).toBe(title)
}

async function waitForScreen(d: TestDaemon, id: string, text: string): Promise<void> {
  await expect
    .poll(async () => (await d.client.request('term.snapshot', { id })).text, { timeout: 15_000 })
    .toContain(text)
}

describe('sidebar titles from the session', () => {
  describe('a live session', () => {
    it('titles the workspace with the name the session writes, and follows a rename in Claude', async () => {
      vi.stubEnv('QUE_FAKE_CLAUDE_TITLE', LABEL)
      const { d, ws } = await start()
      const updated = recordEvents(d.client, 'workspace.updated')
      expect(await titleOf(d, ws.id)).toEqual({
        title: 'Raise the upload timeout',
        titleSource: 'brief'
      })

      // The fake writes its title before its SessionStart hook lands, as a resumed session does.
      const { term: id } = await runClaude(d, ws.id)

      await expect
        .poll(() => titleOf(d, ws.id), { timeout: 15_000 })
        .toEqual({ title: LABEL, titleSource: 'terminal' })
      expect(updated).toContainEqual(
        expect.objectContaining({ id: ws.id, title: LABEL, titleSource: 'terminal' })
      )

      await d.client.request('term.write', { id, data: '/rename Retry backoff for uploads\r' })

      await expect
        .poll(() => titleOf(d, ws.id), { timeout: 15_000 })
        .toEqual({ title: 'Retry backoff for uploads', titleSource: 'terminal' })
    }, 60_000)

    it('keeps the label when the session exits and clears its title', async () => {
      vi.stubEnv('QUE_FAKE_CLAUDE_TITLE', LABEL)
      const { d, ws } = await start()
      const { term: id } = await runClaude(d, ws.id)
      await expect
        .poll(async () => (await titleOf(d, ws.id)).title, { timeout: 15_000 })
        .toBe(LABEL)

      await d.client.request('term.write', { id, data: '/exit\r' })

      await waitForTermTitle(d, id, undefined)
      expect(await titleOf(d, ws.id)).toEqual({ title: LABEL, titleSource: 'terminal' })
    }, 60_000)
  })

  describe('titles that stay', () => {
    it('keeps a title the user set in que through later titles from the session', async () => {
      vi.stubEnv('QUE_FAKE_CLAUDE_TITLE', LABEL)
      const { d, ws } = await start()
      const { term: id } = await runClaude(d, ws.id)
      await expect
        .poll(async () => (await titleOf(d, ws.id)).title, { timeout: 15_000 })
        .toBe(LABEL)

      await d.client.request('workspace.rename', { id: ws.id, title: 'Upload timeouts on CI' })
      await d.client.request('term.write', { id, data: 'raise it to a minute\r' })
      await waitForScreen(d, id, 'Fake reply to: raise it to a minute')
      await d.client.request('term.write', { id, data: '/rename Minute upload timeout\r' })
      await waitForTermTitle(d, id, '✳ Minute upload timeout')

      expect(await titleOf(d, ws.id)).toEqual({
        title: 'Upload timeouts on CI',
        titleSource: 'user'
      })
    }, 60_000)

    it('never relabels a workspace created with an explicit title', async () => {
      vi.stubEnv('QUE_FAKE_CLAUDE_TITLE', LABEL)
      const { d, ws } = await start({ title: 'Uploader retries', brief: BRIEF })
      const { term: id } = await runClaude(d, ws.id)

      await d.client.request('term.write', { id, data: '/rename Minute upload timeout\r' })
      await waitForTermTitle(d, id, '✳ Minute upload timeout')

      expect(await titleOf(d, ws.id)).toEqual({ title: 'Uploader retries', titleSource: 'user' })
    }, 60_000)

    it('ignores the title of a plain shell in the same workspace', async () => {
      vi.stubEnv('QUE_FAKE_CLAUDE_TITLE', LABEL)
      const { d, ws } = await start()
      await runClaude(d, ws.id)
      await expect
        .poll(async () => (await titleOf(d, ws.id)).title, { timeout: 15_000 })
        .toBe(LABEL)

      const shell = await d.client.request('workspace.openTerminal', {
        id: ws.id,
        cols: 100,
        rows: 30
      })

      await d.client.request('term.write', {
        id: shell.id,
        data: "printf '\\033]0;✳ Not a session\\007'\r"
      })

      await waitForTermTitle(d, shell.id, '✳ Not a session')
      expect(await titleOf(d, ws.id)).toEqual({ title: LABEL, titleSource: 'terminal' })
    }, 60_000)
  })
})
