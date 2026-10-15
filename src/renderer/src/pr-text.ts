// Pull request comment bodies as text: plain runs keep their line breaks, and
// ``` fenced blocks come out separately so they can be drawn in mono.

export type TextPart = { kind: 'text'; text: string } | { kind: 'code'; text: string; lang: string }

const FENCE = /^\s*```(.*)$/

/**
 * Splits a comment body into text and fenced code, in order. A fence opens on a
 * line starting with ``` (an info string after it names the language) and closes
 * on the next such line; an unclosed fence runs to the end. Empty text runs are
 * dropped, as are the line breaks that only separate a run from a fence.
 */
export function splitFences(body: string): TextPart[] {
  const parts: TextPart[] = []
  let text: string[] = []
  let code: string[] | null = null
  let lang = ''
  const flushText = (): void => {
    const t = text.join('\n')
    if (t.trim() !== '') parts.push({ kind: 'text', text: t.replace(/^\n+|\n+$/g, '') })
    text = []
  }
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const fence = FENCE.exec(line)
    if (code === null) {
      if (fence) {
        flushText()
        code = []
        lang = fence[1].trim()
      } else text.push(line)
    } else if (fence && fence[1].trim() === '') {
      parts.push({ kind: 'code', text: code.join('\n'), lang })
      code = null
    } else code.push(line)
  }
  if (code !== null) parts.push({ kind: 'code', text: code.join('\n'), lang })
  else flushText()
  return parts
}
