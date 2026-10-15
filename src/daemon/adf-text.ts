// Flattens a tracker document (its rich text, JSON nodes) to readable plain
// text for a ticket brief.

interface Mark {
  type?: string
  attrs?: Record<string, unknown>
}

interface Node {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: Mark[]
  content?: Node[]
}

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v)

function children(n: Node): Node[] {
  return Array.isArray(n.content) ? n.content.filter(isNode) : []
}

function inline(n: Node): string {
  return children(n).map(inlineNode).join('')
}

function inlineNode(n: Node): string {
  switch (n.type) {
    case 'text': {
      let t = n.text ?? ''
      for (const m of n.marks ?? []) {
        if (m.type === 'code') t = `\`${t}\``
        else if (m.type === 'link' && typeof m.attrs?.href === 'string')
          t = `${t} (${m.attrs.href})`
      }
      return t
    }
    case 'hardBreak':
      return '\n'
    case 'mention':
      return `@${String(n.attrs?.text ?? '').replace(/^@/, '')}`
    case 'inlineCard':
      return String(n.attrs?.url ?? '')
    default:
      return n.content ? inline(n) : (n.text ?? '')
  }
}

function indent(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n')
}

function list(n: Node, ordered: boolean): string {
  return children(n)
    .map((item, i) => {
      const marker = ordered ? `${i + 1}. ` : '- '
      const parts = children(item)
        .map(block)
        .filter((s) => s !== '')
      // First block follows the marker; the rest (nested lists, paragraphs) hang under it.
      const [first = '', ...rest] = parts
      const head = marker + first.split('\n').join('\n  ')
      const tail = rest.map((r) => indent(r, '  ')).join('\n')
      return tail ? `${head}\n${tail}` : head
    })
    .join('\n')
}

function block(n: Node): string {
  switch (n.type) {
    case 'paragraph':
      return inline(n)
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(n.attrs?.level) || 1))
      return `${'#'.repeat(level)} ${inline(n)}`
    }
    case 'bulletList':
      return list(n, false)
    case 'orderedList':
      return list(n, true)
    case 'listItem':
      return blocks(children(n))
    case 'codeBlock': {
      const lang = typeof n.attrs?.language === 'string' ? n.attrs.language : ''
      const code = children(n)
        .map((c) => c.text ?? '')
        .join('')
      return `\`\`\`${lang}\n${code}\n\`\`\``
    }
    case 'rule':
      return '---'
    case 'table':
      return children(n).map(block).join('\n')
    case 'tableRow':
      return children(n)
        .map((cell) => blocks(children(cell)).replace(/\n+/g, ' '))
        .join(' | ')
    case 'blockquote':
      return blocks(children(n))
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n')
    case 'panel':
      return blocks(children(n))
    default:
      return n.content ? blocks(children(n)) : inlineNode(n)
  }
}

function blocks(nodes: Node[]): string {
  return nodes
    .map(block)
    .filter((s) => s !== '')
    .join('\n\n')
}

/** Plain text for a document; a string is returned as is, anything else is ''. */
export function adfToText(doc: unknown): string {
  if (typeof doc === 'string') return doc
  if (!isNode(doc)) return ''
  return (doc.type === 'doc' || doc.content ? blocks(children(doc)) : block(doc)).trim()
}
