// Decodes one line of a Claude Code session transcript (JSON lines) into what
// the summariser reads: the text of an assistant entry. The transcript's own
// field names stay in this file.
import { isObj, objects } from '../shared/json.decode'

/**
 * The text of one transcript line when it is an assistant entry: its text blocks
 * (or string content) trimmed and joined; null for any other line, a malformed one,
 * or an assistant entry with no text (only tool calls).
 */
export function decodeAssistantText(line: string): string | null {
  let entry: unknown

  try {
    entry = JSON.parse(line)
  } catch {
    return null
  }

  if (!isObj(entry) || entry.type !== 'assistant' || !isObj(entry.message)) return null
  const content = entry.message.content

  if (typeof content === 'string') return content.trim() || null
  const texts: string[] = []

  for (const block of objects(content)) {
    const text = block.type === 'text' && typeof block.text === 'string' ? block.text.trim() : ''

    if (text) texts.push(text)
  }

  return texts.length > 0 ? texts.join('\n') : null
}
