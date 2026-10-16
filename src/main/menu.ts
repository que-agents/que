// The application menu: the defaults, minus Cmd+T / Cmd+W (the renderer uses
// them for terminal tabs), plus "Install 'que' command in PATH" in a packaged app.
import os from 'node:os'
import { join } from 'node:path'
import { app, dialog, Menu, type MenuItemConstructorOptions } from 'electron'
import { describeCliInstall, installCli } from './install-cli'

async function installCommand(): Promise<void> {
  const launcher = join(process.resourcesPath, 'cli', 'que')

  try {
    const plan = installCli(launcher, os.homedir())
    const { message, detail } = describeCliInstall(plan)
    await dialog.showMessageBox({
      type: plan.action === 'refuse' ? 'warning' : 'info',
      message,
      detail
    })
  } catch (err) {
    await dialog.showMessageBox({
      type: 'error',
      message: "Could not install the 'que' command",
      detail: (err as Error).message
    })
  }
}

export function installMenu(): void {
  const appMenu: MenuItemConstructorOptions = app.isPackaged
    ? {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: "Install 'que' command in PATH", click: () => void installCommand() },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }
    : { role: 'appMenu' }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      appMenu,
      {
        label: 'File',
        submenu: [{ role: 'close', accelerator: 'Shift+CommandOrControl+W' }]
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  )
}
