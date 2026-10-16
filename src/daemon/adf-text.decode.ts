// Decodes a tracker document (its rich text: a tree of typed JSON nodes with
// `content` arrays and `marks`) into a typed node tree for adf-text.ts.

export type AdfMark = { kind: 'code' } | { kind: 'link'; href: string } | { kind: 'other' }

/** A node kind adf-text.ts renders by its children. */
export type AdfContainerKind =
  | 'doc'
  | 'paragraph'
  | 'bulletList'
  | 'orderedList'
  | 'listItem'
  | 'table'
  | 'tableRow'
  | 'blockquote'
  | 'panel'

export type AdfNode =
  | { kind: AdfContainerKind; content: AdfNode[] }
  | { kind: 'heading'; level: number; content: AdfNode[] }
  | { kind: 'codeBlock'; language: string; content: AdfNode[] }
  | { kind: 'text'; text: string; marks: AdfMark[] }
  | { kind: 'hardBreak' }
  | { kind: 'mention'; text: string }
  | { kind: 'inlineCard'; url: string }
  | { kind: 'rule' }
  /** Any other node (table cells, emoji, …): its children when it has some, else its text. */
  | { kind: 'unknown-node'; type: string; text: string | null; content: AdfNode[] | null }

/** A description as the tracker sends it: a document, a plain string, or nothing usable. */
export type AdfDocument = AdfNode | { kind: 'plain'; text: string } | null

type Obj = { [key: string]: unknown }

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function decodeMark(v: unknown): AdfMark | null {
  if (!isObj(v)) return null

  if (v.type === 'code') return { kind: 'code' }
  const href = isObj(v.attrs) ? v.attrs.href : undefined

  if (v.type === 'link' && typeof href === 'string') return { kind: 'link', href }

  return { kind: 'other' }
}

/** The node's children, dropping entries that are not nodes; null when it has no `content`. */
function decodeContent(v: Obj): AdfNode[] | null {
  if (!v.content) return null

  return Array.isArray(v.content) ? v.content.flatMap((c) => decodeAdfNode(c) ?? []) : []
}

/** One node and its subtree, or null for anything that is not an object. */
export function decodeAdfNode(v: unknown): AdfNode | null {
  if (!isObj(v)) return null
  const type = typeof v.type === 'string' ? v.type : ''
  const attrs: Obj = isObj(v.attrs) ? v.attrs : {}
  const content = decodeContent(v)
  const text = typeof v.text === 'string' ? v.text : null

  switch (type) {
    case 'doc':
    case 'paragraph':
    case 'bulletList':
    case 'orderedList':
    case 'listItem':
    case 'table':
    case 'tableRow':
    case 'blockquote':
    case 'panel':
      return { kind: type, content: content ?? [] }
    case 'heading':
      return { kind: 'heading', level: Number(attrs.level) || 1, content: content ?? [] }
    case 'codeBlock':
      return {
        kind: 'codeBlock',
        language: typeof attrs.language === 'string' ? attrs.language : '',
        content: content ?? []
      }

    case 'text': {
      const marks = Array.isArray(v.marks) ? v.marks.flatMap((m) => decodeMark(m) ?? []) : []

      return { kind: 'text', text: text ?? '', marks }
    }

    case 'hardBreak':
      return { kind: 'hardBreak' }
    case 'mention':
      return { kind: 'mention', text: String(attrs.text ?? '') }
    case 'inlineCard':
      return { kind: 'inlineCard', url: String(attrs.url ?? '') }
    case 'rule':
      return { kind: 'rule' }
    default:
      return { kind: 'unknown-node', type, text, content }
  }
}

/** A description: a string stays plain text, an object becomes a node tree, anything else null. */
export function decodeAdf(v: unknown): AdfDocument {
  if (typeof v === 'string') return { kind: 'plain', text: v }

  return decodeAdfNode(v)
}
