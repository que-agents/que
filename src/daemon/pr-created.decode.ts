// Reads a Bash PostToolUse hook payload into the command it ran and the text
// it printed, for pr-created.ts. The response's shape varies (a string, or an
// object such as `{ stdout, stderr }`), so every string in it counts.
import type { HookEvent } from '../shared/protocol'
import { isObj, str } from '../shared/json.decode'

/** A Bash call that finished: its command and every piece of text in its response. */
export interface BashCall {
  command: string
  output: string[]
}

/** Every string in a value, however deeply nested in lists and objects. */
function stringsIn(v: unknown, out: string[] = []): string[] {
  const s = str(v)

  if (s !== undefined) out.push(s)
  else if (Array.isArray(v)) for (const item of v) stringsIn(item, out)
  else if (isObj(v)) for (const item of Object.values(v)) stringsIn(item, out)

  return out
}

/** The Bash call a PostToolUse reports; null for any other event or tool, or without a command. */
export function decodeBashCall(event: HookEvent): BashCall | null {
  if (event.hook_event_name !== 'PostToolUse' || event.tool_name !== 'Bash') return null
  const command = str(event.tool_input?.command)

  return command === undefined ? null : { command, output: stringsIn(event.tool_response) }
}
