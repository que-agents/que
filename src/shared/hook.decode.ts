// Decodes the hook JSON Claude Code writes to a hook command's stdin. Shared
// by `que hook` (which decodes before forwarding) and the daemon (which
// decodes the `hook.event` payload once as it arrives on the socket).
import { HOOK_EVENT_NAMES, type HookEvent, type HookEventName } from './protocol'
import { isObj, type Obj, str } from './json.decode'

type OptionalFields = Omit<HookEvent, 'hook_event_name' | 'session_id' | 'cwd' | 'transcript_path'>

function isEventName(v: unknown): v is HookEventName {
  return HOOK_EVENT_NAMES.some((name) => name === v)
}

function decodeSource(v: unknown): HookEvent['source'] {
  return v === 'startup' || v === 'resume' || v === 'clear' || v === 'compact' ? v : undefined
}

/** Copies the optional fields that are present with the right type. */
function optional(v: Obj): OptionalFields {
  const out: OptionalFields = {}

  const strings = [
    'permission_mode',
    'agent_id',
    'agent_type',
    'prompt',
    'prompt_id',
    'tool_name',
    'tool_use_id',
    'notification_type',
    'message',
    'title',
    'last_assistant_message',
    'error',
    'error_details',
    'reason'
  ] as const

  for (const key of strings) {
    const value = str(v[key])

    if (value !== undefined) out[key] = value
  }

  const source = decodeSource(v.source)

  if (source !== undefined) out.source = source

  if (isObj(v.tool_input)) out.tool_input = v.tool_input

  if ('tool_response' in v) out.tool_response = v.tool_response

  if (typeof v.stop_hook_active === 'boolean') out.stop_hook_active = v.stop_hook_active

  return out
}

/**
 * One hook payload as a `HookEvent`, or null when it is not an object with a
 * known `hook_event_name` and the common string fields (`session_id`, `cwd`,
 * `transcript_path`). Fields que does not know are dropped.
 */
export function decodeHookEvent(v: unknown): HookEvent | null {
  if (!isObj(v) || !isEventName(v.hook_event_name)) return null
  const sessionId = str(v.session_id)
  const cwd = str(v.cwd)
  const transcriptPath = str(v.transcript_path)

  if (sessionId === undefined || cwd === undefined || transcriptPath === undefined) return null

  return {
    ...optional(v),
    hook_event_name: v.hook_event_name,
    session_id: sessionId,
    cwd,
    transcript_path: transcriptPath
  }
}
