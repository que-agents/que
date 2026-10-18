// The hook events que registers with Claude Code. Kept apart from protocol.ts
// so hook.decode.ts can use the list without importing the protocol.

export const HOOK_EVENT_NAMES = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'Notification',
  'PermissionRequest',
  'PreCompact',
  'SubagentStart',
  'SubagentStop'
] as const

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number]
