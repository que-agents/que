import os from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { DaemonClient } from '../shared/client'
import type { EventName, MethodName } from '../shared/protocol'

// The daemon owns every terminal and workspace. This process only proxies the
// allowed calls and their events between the renderer and the daemon;
// quitting leaves terminals alive.

let mainWindow: BrowserWindow | null = null
let client: DaemonClient | null = null
let connecting: Promise<DaemonClient> | null = null

/** Methods the renderer may call through the preload bridge. */
const ALLOWED: ReadonlySet<MethodName> = new Set<MethodName>([
  'term.create',
  'term.list',
  'term.attach',
  'term.detach',
  'term.write',
  'term.resize',
  'term.kill',
  'term.snapshot',
  'project.add',
  'project.list',
  'project.remove',
  'workspace.create',
  'workspace.list',
  'workspace.get',
  'workspace.remove',
  'workspace.openTerminal'
])
const FORWARDED_EVENTS: EventName[] = [
  'term.data',
  'term.exit',
  'term.created',
  'term.killed',
  'workspace.created',
  'workspace.updated',
  'workspace.removed',
  'workspace.status'
]

function getClient(): Promise<DaemonClient> {
  if (client?.connected) return Promise.resolve(client)
  if (!connecting) {
    connecting = DaemonClient.connectOrStart({ log: (m) => console.log(`[daemon] ${m}`) })
      .then((c) => {
        client = c
        for (const ev of FORWARDED_EVENTS) {
          c.on(ev, (data) => sendToRenderer('que:event', ev, data))
        }
        c.onClose(() => {
          if (client === c) client = null
          sendToRenderer('que:event', 'daemon.disconnected', {})
        })
        return c
      })
      .finally(() => {
        connecting = null
      })
  }
  return connecting
}

function createWindow(): void {
  const e2e = process.env.QUE_E2E === '1'
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    // Under e2e the window must not steal OS focus, or stray keystrokes from
    // the desktop land in the terminal under test.
    show: !e2e,
    backgroundColor: '#1e1e1e',
    title: 'que',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Read by the preload to decide whether to expose the e2e test hook.
      additionalArguments: e2e ? ['--que-e2e'] : []
    }
  })
  if (e2e) mainWindow.showInactive()

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  const wc = mainWindow?.webContents
  if (!wc || wc.isDestroyed() || wc.isCrashed()) return
  try {
    wc.send(channel, ...args)
  } catch {
    // The frame can be torn down mid-send during shutdown or reload.
  }
}

function registerIpc(): void {
  ipcMain.handle('app:homedir', () => os.homedir())

  ipcMain.handle('dialog:openFolder', async () => {
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('que:request', async (_e, method: MethodName, params: unknown) => {
    if (!ALLOWED.has(method)) throw new Error(`method not allowed: ${method}`)
    const c = await getClient()
    try {
      return { ok: true, result: await c.request(method, params as never) }
    } catch (err) {
      // Errors thrown across ipc lose their fields; return them as data.
      const e = err as { code?: string; message?: string }
      return { ok: false, error: { code: e.code ?? 'error', message: e.message ?? String(err) } }
    }
  })

  // Fire-and-forget path for keystrokes, avoiding a round trip per key.
  ipcMain.on('que:write', (_e, id: string, data: string) => {
    void getClient()
      .then((c) => c.request('term.write', { id, data }))
      .catch(() => {})
  })
}

app.whenReady().then(async () => {
  registerIpc()
  try {
    await getClient()
  } catch (err) {
    console.error('failed to reach que daemon:', err)
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  // Only the connection goes away; the daemon and its terminals keep running.
  client?.close()
})
