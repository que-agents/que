import os from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { PtyManager } from './pty'

const ptys = new PtyManager()
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: '#1e1e1e',
    title: 'que',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // node-pty lives in the main process; the preload only uses
      // contextBridge and ipcRenderer, so the renderer can stay sandboxed.
      sandbox: true
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    ptys.killAll()
  })

  // A reload or renderer crash orphans the terminals the old page owned.
  const wc = mainWindow.webContents
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) ptys.killAll()
  })
  wc.on('render-process-gone', () => ptys.killAll())

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

  ipcMain.handle('pty:spawn', (_e, opts: { cwd?: string; cols: number; rows: number }) => {
    const id = ptys.spawn({ cwd: opts.cwd, cols: opts.cols, rows: opts.rows })
    return { id }
  })
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) =>
    ptys.resize(id, cols, rows)
  )
  ipcMain.on('pty:kill', (_e, id: string) => ptys.kill(id))

  ptys.onData((id, data) => sendToRenderer('pty:data', id, data))
  ptys.onExit((id, info) => sendToRenderer('pty:exit', id, info))
}

// --- SMOKE TEST HOOK (QUE_SMOKE=1) -----------------------------------------
// Headless check used by scripts/smoke.mjs: spawn a PTY through PtyManager,
// wait for a marker line, print it, and exit. No window is created.
function runSmoke(): void {
  const timer = setTimeout(() => {
    console.error('QUE_SMOKE_TIMEOUT')
    app.exit(1)
  }, 10_000)
  let buf = ''
  ptys.onData((_id, data) => {
    buf += data
    if (buf.includes('QUE_SMOKE_OK')) {
      clearTimeout(timer)
      console.log('QUE_SMOKE_OK')
      ptys.killAll()
      app.exit(0)
    }
  })
  ptys.spawn({ file: '/bin/sh', args: ['-c', 'printf "QUE_SMOKE_OK\\n"'], cols: 80, rows: 24 })
}
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  if (process.env.QUE_SMOKE === '1') {
    runSmoke()
    return
  }
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => ptys.killAll())
