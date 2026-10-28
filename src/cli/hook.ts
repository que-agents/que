// `que hook`: the command Claude Code runs for every hook event inside a que
// workspace. It forwards the hook JSON to the daemon and always exits 0
// without printing to stdout: hook stdout can be read as a decision (for
// PermissionRequest), and que never decides anything for the user.
import net from 'node:net'
import { decodeHookEvent } from '../shared/hook.decode'
import { quePaths } from '../shared/paths'
import { encode, type HookEvent, type MethodName, type ParamsOf } from '../shared/protocol'

const BUDGET_MS = 1500

/**
 * Connects, sends one request, and waits for its reply (result or error).
 * Never rejects: a missing daemon ends it too. Shared with `que statusline`.
 */
export function requestOnce<M extends MethodName>(
  socketPath: string,
  method: M,
  params: ParamsOf<M>
): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath)
    socket.setEncoding('utf8')
    socket.once('connect', () => {
      socket.write(encode({ id: 1, method, params }))
    })
    // Any reply (result or error) ends the exchange.
    socket.once('data', () => {
      socket.destroy()
      resolve()
    })
    socket.once('error', () => resolve())
    socket.once('close', () => resolve())
  })
}

/** Reads all of stdin as text; empty for a terminal. */
export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('')
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c: string) => (data += c))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

/** Waits for `work` at most `ms`, never rejecting: a session must not wait on que. */
export async function withBudget(work: Promise<unknown>, ms: number): Promise<void> {
  await Promise.race([work.catch(() => {}), new Promise((r) => setTimeout(r, ms).unref())])
}

/** The daemon's socket as a session sees it: QUE_SOCKET when the terminal set it. */
export function sessionSocket(): string {
  return process.env.QUE_SOCKET || quePaths().socket
}

export async function runHook(): Promise<void> {
  const workspaceId = process.env.QUE_WORKSPACE_ID

  if (!workspaceId) return

  const work = (async () => {
    const text = await readStdin()
    let payload: HookEvent | null

    try {
      payload = decodeHookEvent(JSON.parse(text))
    } catch {
      return
    }

    if (!payload) return
    // Hooks only see the environment: a daemon terminal sets QUE_TERMINAL_ID.
    // When it is unset it is left out of the frame.
    await requestOnce(sessionSocket(), 'hook.event', {
      workspaceId,
      terminalId: process.env.QUE_TERMINAL_ID || undefined,
      payload
    })
  })()

  await withBudget(work, BUDGET_MS)
}
