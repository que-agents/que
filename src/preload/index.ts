import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { PtyExitInfo, QueApi } from './index.d'

const api: QueApi = {
  pty: {
    spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: (id, cb) => {
      const listener = (_e: IpcRendererEvent, sid: string, data: string): void => {
        if (sid === id) cb(data)
      }
      ipcRenderer.on('pty:data', listener)
      return () => ipcRenderer.removeListener('pty:data', listener)
    },
    onExit: (id, cb) => {
      const listener = (_e: IpcRendererEvent, sid: string, info: PtyExitInfo): void => {
        if (sid === id) cb(info)
      }
      ipcRenderer.on('pty:exit', listener)
      return () => ipcRenderer.removeListener('pty:exit', listener)
    }
  },
  app: {
    homedir: () => ipcRenderer.invoke('app:homedir'),
    openFolder: () => ipcRenderer.invoke('dialog:openFolder')
  }
}

contextBridge.exposeInMainWorld('que', api)
