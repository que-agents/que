// Decodes what `claude agents --json` prints: a list of agents, or an object
// holding one under `agents`. Each entry keeps the cwd and status it names.
import { fieldsOf, objects, str } from '../shared/json.decode'
import type { AgentEntry } from './status-engine'

/** The agent entries; null when the output is neither a list nor `{ agents: [...] }`. */
export function decodeAgents(v: unknown): AgentEntry[] | null {
  const list = Array.isArray(v) ? v : fieldsOf(v).agents

  if (!Array.isArray(list)) return null

  return objects(list).map((e) => {
    const entry: AgentEntry = {}
    const cwd = str(e.cwd)
    const status = str(e.status)

    if (cwd !== undefined) entry.cwd = cwd

    if (status !== undefined) entry.status = status

    return entry
  })
}
