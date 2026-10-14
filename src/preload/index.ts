import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { QueApi } from './index.d'

type Reply = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } }

async function call<T>(method: string, params?: unknown): Promise<T> {
  const reply = (await ipcRenderer.invoke('que:request', method, params)) as Reply
  if (reply.ok) return reply.result as T
  const err = new Error(reply.error.message) as Error & { code?: string }
  err.code = reply.error.code
  throw err
}

function subscribe(event: string, cb: (data: unknown) => void): () => void {
  const listener = (_e: IpcRendererEvent, name: string, data: unknown): void => {
    if (name === event) cb(data)
  }
  ipcRenderer.on('que:event', listener)
  return () => ipcRenderer.removeListener('que:event', listener)
}

const api: QueApi = {
  term: {
    create: (p) => call('term.create', p),
    list: (p) => call('term.list', p),
    attach: (p) => call('term.attach', p),
    detach: (p) => call('term.detach', p),
    write: (p) => ipcRenderer.send('que:write', p.id, p.data),
    resize: (p) => call('term.resize', p),
    kill: (p) => call('term.kill', p),
    snapshot: (p) => call('term.snapshot', p),
    on: (event, cb) => subscribe(event, cb as (data: unknown) => void),
    onDisconnect: (cb) => subscribe('daemon.disconnected', cb)
  },
  project: {
    add: (p) => call('project.add', p),
    list: () => call('project.list'),
    remove: (p) => call('project.remove', p)
  },
  workspace: {
    create: (p) => call('workspace.create', p),
    list: (p) => call('workspace.list', p),
    get: (p) => call('workspace.get', p),
    remove: (p) => call('workspace.remove', p),
    openTerminal: (p) => call('workspace.openTerminal', p),
    on: (event, cb) => subscribe(event, cb as (data: unknown) => void)
  },
  app: {
    homedir: () => ipcRenderer.invoke('app:homedir'),
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    e2e: process.argv.includes('--que-e2e')
  }
}

contextBridge.exposeInMainWorld('que', api)
