// Decodes each method's params from the JSON a client sent. The daemon runs
// these before a handler sees anything, so a handler works with typed values.
// Free of node modules so the renderer can import it too.
import { decodeHookEvent } from './hook.decode'
import type { MethodName, ParamsOf } from './protocol'
import type { ConfigPatch, TaskSource, TaskState } from './types'

/** Thrown for params that are missing or have the wrong type; the daemon answers `bad_request`. */
export class ParamsError extends Error {}

type Params = Record<string, unknown> | undefined

function str(p: Params, key: string): string {
  const v = p?.[key]

  if (typeof v !== 'string') throw new ParamsError(`${key} must be a string`)

  return v
}

/** A reader that also takes an absent (undefined or null) parameter as undefined. */
function opt<T>(p: Params, key: string, read: (p: Params, key: string) => T): T | undefined {
  return p?.[key] === undefined || p[key] === null ? undefined : read(p, key)
}

function optString(p: Params, key: string): string | undefined {
  return opt(p, key, str)
}

function optStringArray(p: Params, key: string): string[] | undefined {
  return opt(p, key, (q, k) => {
    const v = q?.[k]

    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
      throw new ParamsError(`${k} must be an array of strings`)
    }

    return v
  })
}

function optBool(p: Params, key: string): boolean | undefined {
  return opt(p, key, (q, k) => {
    const v = q?.[k]

    if (typeof v !== 'boolean') throw new ParamsError(`${k} must be a boolean`)

    return v
  })
}

function optNumber(p: Params, key: string): number | undefined {
  return opt(p, key, (q, k) => {
    const v = q?.[k]

    if (typeof v !== 'number' || !Number.isFinite(v)) throw new ParamsError(`${k} must be a number`)

    return v
  })
}

/** A size or count: a finite number of at least 1. */
function num(p: Params, key: string): number {
  const v = p?.[key]

  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) {
    throw new ParamsError(`${key} must be a positive number`)
  }

  return v
}

const none = (): undefined => undefined
const idOnly = (p: Params): { id: string } => ({ id: str(p, 'id') })

/** One decoder per method; the mapped type makes a missing or extra one a compile error. */
export const decoders: { [M in MethodName]: (p: Params) => ParamsOf<M> } = {
  'daemon.ping': none,
  'daemon.shutdown': none,
  'term.create': (p) => ({
    cwd: optString(p, 'cwd'),
    cols: num(p, 'cols'),
    rows: num(p, 'rows'),
    name: optString(p, 'name'),
    file: optString(p, 'file'),
    args: optStringArray(p, 'args')
  }),
  'term.list': (p) => ({ workspaceId: optString(p, 'workspaceId') }),
  'term.attach': (p) => ({ id: str(p, 'id'), cols: num(p, 'cols'), rows: num(p, 'rows') }),
  'term.detach': idOnly,
  'term.write': (p) => ({ id: str(p, 'id'), data: str(p, 'data') }),
  'term.resize': (p) => ({ id: str(p, 'id'), cols: num(p, 'cols'), rows: num(p, 'rows') }),
  'term.kill': idOnly,
  'term.snapshot': idOnly,
  'project.add': (p) => ({
    path: optString(p, 'path'),
    repo: optString(p, 'repo'),
    cwd: optString(p, 'cwd'),
    name: optString(p, 'name')
  }),
  'project.list': none,
  'project.remove': (p) => ({ id: str(p, 'id'), force: optBool(p, 'force') }),
  'workspace.create': (p) => ({
    projectId: str(p, 'projectId'),
    name: optString(p, 'name'),
    title: optString(p, 'title'),
    brief: optString(p, 'brief'),
    baseRef: optString(p, 'baseRef'),
    branch: optString(p, 'branch')
  }),
  'workspace.list': (p) => ({ projectId: optString(p, 'projectId') }),
  'workspace.get': idOnly,
  'workspace.remove': (p) => ({ id: str(p, 'id'), deleteBranch: optBool(p, 'deleteBranch') }),
  'workspace.openTerminal': (p) => ({
    id: str(p, 'id'),
    cols: num(p, 'cols'),
    rows: num(p, 'rows')
  }),
  'workspace.createPr': (p) => ({ id: str(p, 'id'), title: str(p, 'title') }),
  'workspace.start': (p) => ({
    id: str(p, 'id'),
    cols: optNumber(p, 'cols'),
    rows: optNumber(p, 'rows')
  }),
  'workspace.rename': (p) => ({
    id: str(p, 'id'),
    title: str(p, 'title'),
    branch: optString(p, 'branch')
  }),
  'workspace.canRenameBranch': idOnly,
  'workspace.diff': (p) => ({
    id: str(p, 'id'),
    base: optString(p, 'base'),
    commit: optString(p, 'commit')
  }),
  'workspace.prThread': (p) => ({ id: str(p, 'id'), refresh: optBool(p, 'refresh') }),
  'workspace.files': idOnly,
  'workspace.readFile': (p) => ({ id: str(p, 'id'), path: str(p, 'path') }),
  'workspace.watch': idOnly,
  'workspace.unwatch': idOnly,
  'hook.event': (p) => {
    const workspaceId = str(p, 'workspaceId')
    const payload = decodeHookEvent(p?.payload)

    if (!payload) throw new ParamsError('payload must be a hook event')

    return { workspaceId, taskId: optString(p, 'taskId'), payload }
  },
  'task.add': (p) => ({
    projectId: optString(p, 'projectId'),
    workspaceId: optString(p, 'workspaceId'),
    title: optString(p, 'title'),
    brief: str(p, 'brief'),
    source: optString(p, 'source') as TaskSource | undefined,
    resumeSessionId: optString(p, 'resumeSessionId'),
    maxTurns: optNumber(p, 'maxTurns'),
    maxBudgetUsd: optNumber(p, 'maxBudgetUsd')
  }),
  'task.list': (p) => ({ state: optString(p, 'state') as TaskState | undefined }),
  'task.get': idOnly,
  'task.stop': idOnly,
  'task.remove': idOnly,
  'queue.open': (p) => ({ concurrency: optNumber(p, 'concurrency') }),
  'queue.close': none,
  'queue.state': none,
  'report.get': (p) => ({ since: optString(p, 'since') }),
  'quiet.state': none,
  'quiet.unlock': (p) => ({ minutes: optNumber(p, 'minutes'), why: optString(p, 'why') }),
  'quiet.lock': none,
  'quiet.log': (p) => ({ since: optString(p, 'since') }),
  'config.get': none,
  'config.set': (p) => {
    const patch = p?.patch

    // The shape of the patch is checked where it is merged into the file.
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new ParamsError('patch must be an object')
    }

    return { patch: patch as ConfigPatch, applyTonight: optBool(p, 'applyTonight') }
  },
  'instructions.get': none,
  'instructions.set': (p) => ({ content: str(p, 'content') }),
  'tickets.list': none,
  'tickets.sync': none,
  'tickets.start': (p) => ({
    key: str(p, 'key'),
    projectId: optString(p, 'projectId'),
    session: optBool(p, 'session')
  }),
  'tickets.projectFor': (p) => ({ key: str(p, 'key') })
}
