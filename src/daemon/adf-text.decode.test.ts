import { describe, expect, it } from 'vitest'
import { makeFakeIssue } from '../testing/fakes'
import { decodeAdf } from './adf-text.decode'

describe('decodeAdf', () => {
  it('decodes a ticket description into typed nodes', () => {
    const doc = decodeAdf(makeFakeIssue().fields.description)

    expect(doc).toMatchObject({
      kind: 'doc',
      content: [
        {
          kind: 'paragraph',
          content: [{ kind: 'text', text: 'Uploads fail on flaky networks and are never retried.' }]
        },
        { kind: 'heading', level: 2 },
        { kind: 'bulletList', content: [{ kind: 'listItem' }, { kind: 'listItem' }] },
        { kind: 'codeBlock', language: 'ts' }
      ]
    })
  })

  it('reads code and link marks and keeps others as other', () => {
    const text = decodeAdf({
      type: 'text',
      text: 'docs',
      marks: [{ type: 'link', attrs: { href: 'https://example.com' } }, { type: 'strong' }, 'x']
    })

    expect(text).toEqual({
      kind: 'text',
      text: 'docs',
      marks: [{ kind: 'link', href: 'https://example.com' }, { kind: 'other' }]
    })
  })

  it('keeps an unrecognised node kind as an unknown node', () => {
    expect(decodeAdf({ type: 'emoji', text: ':)' })).toEqual({
      kind: 'unknown-node',
      type: 'emoji',
      text: ':)',
      content: null
    })
  })

  it('drops children that are not nodes, and is null for anything but a string or object', () => {
    expect(decodeAdf({ type: 'paragraph', content: [42, null, { type: 'hardBreak' }] })).toEqual({
      kind: 'paragraph',
      content: [{ kind: 'hardBreak' }]
    })
    expect(decodeAdf('plain')).toEqual({ kind: 'plain', text: 'plain' })
    expect(decodeAdf(42)).toBeNull()
    expect(decodeAdf(undefined)).toBeNull()
  })
})
