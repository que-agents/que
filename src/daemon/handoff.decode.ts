// The handoff's wire formats: the snapshot file a daemon writes for its
// successor (one entry per live terminal), and the messages the two exchange
// over the IPC channel. Both come from another process, possibly another
// build of que, so they are decoded field by field and a version mismatch is
// refused rather than guessed at.
import { fieldsOf, isObj, num, objects, str } from '../shared/json.decode'
import type { AdoptSpec } from './adopted-terminal'

/** Bumped whenever the snapshot changes in a way an older successor would misread. */
export const SNAPSHOT_VERSION = 1

export interface HandoffSnapshot {
  version: typeof SNAPSHOT_VERSION
  /** The pid of the daemon that wrote it. */
  from: number
  /** Every terminal handed over; `fd` is its index in the successor's stdio. */
  terminals: AdoptSpec[]
}

/** Thrown for a snapshot this build cannot read. */
export class SnapshotError extends Error {}

export function encodeSnapshot(snapshot: HandoffSnapshot): string {
  return JSON.stringify(snapshot)
}

export function decodeSnapshot(text: string): HandoffSnapshot {
  let v: unknown

  try {
    v = JSON.parse(text)
  } catch {
    throw new SnapshotError('handoff snapshot is not JSON')
  }

  if (!isObj(v)) throw new SnapshotError('handoff snapshot is not an object')

  if (v.version !== SNAPSHOT_VERSION) {
    throw new SnapshotError(
      `handoff snapshot version ${String(v.version)} is not ${SNAPSHOT_VERSION}`
    )
  }

  const from = num(v.from)

  if (from === undefined) throw new SnapshotError('handoff snapshot has no sender pid')

  if (!Array.isArray(v.terminals)) throw new SnapshotError('handoff snapshot has no terminals')

  const terminals = objects(v.terminals).map((t, i) => decodeTerminal(t, i))

  if (terminals.length !== v.terminals.length) {
    throw new SnapshotError('handoff snapshot has a terminal that is not an object')
  }

  return { version: SNAPSHOT_VERSION, from, terminals }
}

function decodeTerminal(t: Record<string, unknown>, i: number): AdoptSpec {
  const need = <T>(value: T | undefined, key: string): T => {
    if (value === undefined) throw new SnapshotError(`handoff terminal ${i}: ${key} is missing`)

    return value
  }

  const spec: AdoptSpec = {
    id: need(str(t.id), 'id'),
    name: need(str(t.name), 'name'),
    cwd: need(str(t.cwd), 'cwd'),
    createdAt: need(str(t.createdAt), 'createdAt'),
    pid: need(int(t.pid, 1), 'pid'),
    cols: need(int(t.cols, 1), 'cols'),
    rows: need(int(t.rows, 1), 'rows'),
    // 0-3 are stdin, stdout, stderr and the IPC channel.
    fd: need(int(t.fd, 4), 'fd'),
    serialized: need(str(t.serialized), 'serialized')
  }

  const workspaceId = str(t.workspaceId)

  if (workspaceId !== undefined) spec.workspaceId = workspaceId

  return spec
}

/** An integer of at least `min`. */
function int(v: unknown, min: number): number | undefined {
  const n = num(v)

  return n !== undefined && Number.isInteger(n) && n >= min ? n : undefined
}

/** What the successor tells the daemon handing over to it. */
export type SuccessorMessage =
  | { type: 'adopted' }
  | { type: 'ready'; pid: number }
  | { type: 'failed'; error: string }

/** What the daemon handing over tells its successor. */
export type PredecessorMessage = { type: 'bind' }

export function decodeSuccessorMessage(v: unknown): SuccessorMessage | null {
  const m = fieldsOf(v)

  if (m.type === 'adopted') return { type: 'adopted' }

  const pid = num(m.pid)

  if (m.type === 'ready' && pid !== undefined) return { type: 'ready', pid }

  if (m.type === 'failed') return { type: 'failed', error: str(m.error) ?? 'unknown error' }

  return null
}

export function decodePredecessorMessage(v: unknown): PredecessorMessage | null {
  return fieldsOf(v).type === 'bind' ? { type: 'bind' } : null
}
