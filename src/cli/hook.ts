// `que hook`: the command Claude Code runs for every hook event inside a que
// workspace. It forwards the hook JSON to the daemon and always exits 0
// without printing to stdout: hook stdout can be read as a decision (for
// PermissionRequest), and que never decides anything for the user.
import net from 'node:net'
import { quePaths } from '../shared/paths'
import { encode } from '../shared/protocol'

const BUDGET_MS = 1500

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('')
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c: string) => (data += c))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

/** Connects, sends one hook.event request, and waits for its reply. */
function deliver(
  socketPath: string,
  workspaceId: string,
  taskId: string | undefined,
  payload: unknown
): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath)
    socket.setEncoding('utf8')
    socket.once('connect', () => {
      // Hooks only see the environment: a headless task run sets QUE_TASK_ID.
      const params = taskId ? { workspaceId, taskId, payload } : { workspaceId, payload }
      socket.write(encode({ id: 1, method: 'hook.event', params }))
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

export async function runHook(): Promise<void> {
  const workspaceId = process.env.QUE_WORKSPACE_ID

  if (!workspaceId) return

  const work = (async () => {
    const text = await readStdin()
    let payload: unknown

    try {
      payload = JSON.parse(text)
    } catch {
      return
    }

    if (typeof payload !== 'object' || payload === null) return
    await deliver(
      process.env.QUE_SOCKET || quePaths().socket,
      workspaceId,
      process.env.QUE_TASK_ID || undefined,
      payload
    )
  })()

  await Promise.race([work.catch(() => {}), new Promise((r) => setTimeout(r, BUDGET_MS).unref())])
}
