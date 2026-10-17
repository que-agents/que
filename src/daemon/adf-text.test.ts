import { describe, expect, it } from 'vitest'
import { adfToText } from './adf-text'
import { decodeAdf } from './adf-text.decode'

const toText = (v: unknown) => adfToText(decodeAdf(v))

const text = (t: string, marks?: unknown[]) => ({
  type: 'text',
  text: t,
  marks: marks || undefined
})

const p = (...content: unknown[]) => ({ type: 'paragraph', content })
const doc = (...content: unknown[]) => ({ type: 'doc', version: 1, content })
const item = (...content: unknown[]) => ({ type: 'listItem', content })

describe('adfToText', () => {
  it('returns a string as is and anything else as empty', () => {
    expect(toText('plain')).toBe('plain')
    expect(toText(null)).toBe('')
    expect(toText(42)).toBe('')
    expect(toText(undefined)).toBe('')
  })

  it('separates paragraphs with a blank line', () => {
    expect(toText(doc(p(text('one')), p(text('two'))))).toBe('one\n\ntwo')
  })

  it('prefixes headings with hashes', () => {
    expect(toText(doc({ type: 'heading', attrs: { level: 3 }, content: [text('Title')] }))).toBe(
      '### Title'
    )
  })

  it('renders bullet and ordered lists', () => {
    const bullets = { type: 'bulletList', content: [item(p(text('a'))), item(p(text('b')))] }
    const ordered = { type: 'orderedList', content: [item(p(text('x'))), item(p(text('y')))] }
    expect(toText(doc(bullets))).toBe('- a\n- b')
    expect(toText(doc(ordered))).toBe('1. x\n2. y')
  })

  it('indents nested lists by two spaces', () => {
    const inner = { type: 'bulletList', content: [item(p(text('child')))] }
    const outer = { type: 'bulletList', content: [item(p(text('parent')), inner)] }
    expect(toText(doc(outer))).toBe('- parent\n  - child')
  })

  it('fences code blocks with the language', () => {
    const block = { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1')] }
    expect(toText(doc(block))).toBe('```ts\nconst a = 1\n```')
    expect(toText(doc({ type: 'codeBlock', content: [text('x')] }))).toBe('```\nx\n```')
  })

  it('turns hard breaks into newlines', () => {
    expect(toText(doc(p(text('a'), { type: 'hardBreak' }, text('b'))))).toBe('a\nb')
  })

  it('writes mentions and inline cards', () => {
    expect(toText(doc(p({ type: 'mention', attrs: { text: '@Ada' } })))).toBe('@Ada')
    expect(toText(doc(p({ type: 'mention', attrs: { text: 'Ada' } })))).toBe('@Ada')
    expect(toText(doc(p({ type: 'inlineCard', attrs: { url: 'https://example.com/x' } })))).toBe(
      'https://example.com/x'
    )
  })

  it('writes link and code marks', () => {
    const link = text('docs', [{ type: 'link', attrs: { href: 'https://example.com' } }])
    expect(toText(doc(p(link)))).toBe('docs (https://example.com)')
    expect(toText(doc(p(text('npm test', [{ type: 'code' }]))))).toBe('`npm test`')
    expect(toText(doc(p(text('bold', [{ type: 'strong' }]))))).toBe('bold')
  })

  it('writes rules', () => {
    expect(toText(doc(p(text('a')), { type: 'rule' }, p(text('b'))))).toBe('a\n\n---\n\nb')
  })

  it('joins table cells with pipes, one row per line', () => {
    const row = (...cells: string[]) => ({
      type: 'tableRow',
      content: cells.map((c, i) => ({
        type: i === 0 ? 'tableHeader' : 'tableCell',
        content: [p(text(c))]
      }))
    })

    expect(toText(doc({ type: 'table', content: [row('a', 'b'), row('c', 'd')] }))).toBe(
      'a | b\nc | d'
    )
  })

  it('prefixes blockquote lines', () => {
    expect(toText(doc({ type: 'blockquote', content: [p(text('one')), p(text('two'))] }))).toBe(
      '> one\n>\n> two'
    )
  })

  it('writes a panel as its content', () => {
    expect(
      toText(doc({ type: 'panel', attrs: { panelType: 'info' }, content: [p(text('note'))] }))
    ).toBe('note')
  })

  it('falls back to the text content of unknown nodes', () => {
    expect(toText(doc({ type: 'mystery', content: [p(text('inside'))] }))).toBe('inside')
    expect(toText(doc(p({ type: 'emoji', text: ':)' })))).toBe(':)')
  })

  it('nests a code block inside a list item', () => {
    const outer = {
      type: 'orderedList',
      content: [
        item(p(text('run')), {
          type: 'codeBlock',
          attrs: { language: 'sh' },
          content: [text('make')]
        })
      ]
    }

    expect(toText(doc(outer))).toBe('1. run\n  ```sh\n  make\n  ```')
  })
})
