// Flattens a tracker document (its rich text, decoded by adf-text.decode.ts) to
// readable plain text for a ticket brief.
import type { AdfDocument, AdfNode } from './adf-text.decode'

function children(n: AdfNode): AdfNode[] {
  return 'content' in n ? (n.content ?? []) : []
}

/** Whether the node carried a `content` list (unknown nodes are rendered by it if so). */
function hasContent(n: AdfNode): boolean {
  return 'content' in n && n.content !== null
}

function textOf(n: AdfNode): string {
  return n.kind === 'text' || n.kind === 'unknown-node' ? (n.text ?? '') : ''
}

function inline(n: AdfNode): string {
  return children(n).map(inlineNode).join('')
}

function inlineNode(n: AdfNode): string {
  switch (n.kind) {
    case 'text': {
      let t = n.text

      for (const m of n.marks) {
        if (m.kind === 'code') t = `\`${t}\``
        else if (m.kind === 'link') t = `${t} (${m.href})`
      }

      return t
    }

    case 'hardBreak':
      return '\n'
    case 'mention':
      return `@${n.text.replace(/^@/, '')}`
    case 'inlineCard':
      return n.url
    default:
      return hasContent(n) ? inline(n) : textOf(n)
  }
}

function indent(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n')
}

function list(n: AdfNode, ordered: boolean): string {
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

function block(n: AdfNode): string {
  switch (n.kind) {
    case 'paragraph':
      return inline(n)
    case 'heading': {
      const level = Math.min(6, Math.max(1, n.level))

      return `${'#'.repeat(level)} ${inline(n)}`
    }

    case 'bulletList':
      return list(n, false)
    case 'orderedList':
      return list(n, true)
    case 'listItem':
      return blocks(children(n))
    case 'codeBlock': {
      const code = n.content.map(textOf).join('')

      return `\`\`\`${n.language}\n${code}\n\`\`\``
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
      return hasContent(n) ? blocks(children(n)) : inlineNode(n)
  }
}

function blocks(nodes: AdfNode[]): string {
  return nodes
    .flatMap((n) => {
      const s = block(n)

      return s === '' ? [] : [s]
    })
    .join('\n\n')
}

/** Plain text for a document; a string is returned as is, nothing is ''. */
export function adfToText(doc: AdfDocument): string {
  if (doc === null) return ''

  if (doc.kind === 'plain') return doc.text

  return (doc.kind === 'doc' || hasContent(doc) ? blocks(children(doc)) : block(doc)).trim()
}
