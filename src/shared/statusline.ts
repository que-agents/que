// The status line que passes each session with --settings, and how
// `que statusline` finds the user's own one to run after it. No Node imports:
// the caller passes the file reader.
import { fieldsOf, str } from './json.decode'

/** The status line command in que's --settings. */
export const QUE_STATUSLINE_COMMAND = 'que statusline'

/** que's own command, however it is spelled: `que statusline`, `/path/to/que statusline …`. */
export function isQueStatusLine(command: string): boolean {
  return /(?:^|[\s/'"])que['"]?\s+statusline(?:\s|$)/.test(command.trim())
}

/** The settings files that can name a status line, most specific first, as Claude Code reads them. */
export function statusLineSettingsFiles(projectDir: string, homeDir: string): string[] {
  return [
    `${projectDir}/.claude/settings.local.json`,
    // Read only, to run the user's own status line after que's; never written.
    `${projectDir}/.claude/settings.json`, // nosemgrep: que-no-claude-settings-json
    `${homeDir}/.claude/settings.json` // nosemgrep: que-no-claude-settings-json
  ]
}

/**
 * The user's own status line command: the first `statusLine` of type
 * `command` that is not que's own, reading the settings files most specific
 * first and stopping at the first that names one. `read` gives a file's text,
 * null when it is missing. A file that does not parse, or names no usable
 * status line, is passed over. Null when none does.
 */
export function findUserStatusLine(
  files: readonly string[],
  read: (path: string) => string | null
): string | null {
  for (const file of files) {
    const text = read(file)

    if (text === null) continue
    let settings: unknown

    try {
      settings = JSON.parse(text)
    } catch {
      continue
    }

    const line = fieldsOf(fieldsOf(settings).statusLine)
    const command = str(line.command)?.trim()

    if (line.type === 'command' && command && !isQueStatusLine(command)) return command
  }

  return null
}
