// The quiet board: a small frameless window that replaces the main window
// during quiet hours. It loads the same renderer with `#board`, which renders
// only the board (counts and rows, no terminals, one Unlock button).
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

export const BOARD_HASH = 'board'

export function createBoardWindow(opts: { e2e: boolean }): BrowserWindow {
  const win = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    resizable: false,
    alwaysOnTop: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#181818',
    title: 'que · quiet hours',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: opts.e2e ? ['--que-e2e'] : []
    }
  })

  win.center()
  // No links and no navigation out of the board.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (ev) => ev.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${BOARD_HASH}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: BOARD_HASH })
  }

  return win
}
