import { describe, expect, it } from 'vitest'
import type { DiffToken } from '../shared/protocol'
import { kindOf, languageFor, tokenizeFile, withBracketDepth } from './highlight'

const text = (tokens: readonly DiffToken[] | undefined): string =>
  (tokens ?? []).map((t) => t.text).join('')

/** The kind of the first token whose text is exactly `word` on that line. */
const kindAt = (tokens: readonly DiffToken[] | undefined, word: string) =>
  tokens?.find((t) => t.text === word)?.kind

const SOURCE = [
  "import { sign } from './sign'",
  '',
  '/** Uploads with retries.',
  ' * Backs off between tries. */',
  'export async function put(file: Blob, retries = 3): Promise<Response> {',
  '  const opts = { method: `PUT ${file.type}`, retries }',
  '  if (opts.retries > 0) return fetch(await sign(file), opts)',
  "  throw new Error('no retries') // never",
  '}',
  ''
].join('\n')

describe('languageFor', () => {
  it('picks a language by file name, then by extension', () => {
    expect(languageFor('src/upload/put.ts')).toBe('typescript')
    expect(languageFor('src/App.tsx')).toBe('tsx')
    expect(languageFor('docker/Dockerfile')).toBe('docker')
    expect(languageFor('tsconfig.node.json')).toBe('jsonc')
    expect(languageFor('package.json')).toBe('json')
    expect(languageFor('scripts/run.sh')).toBe('shellscript')
    expect(languageFor('LICENSE')).toBeNull()
    expect(languageFor('assets/logo.xyz')).toBeNull()
  })
})

describe('kindOf', () => {
  it('lets a comment win over anything inside it', () => {
    expect(
      kindOf(['source.ts', 'comment.block.documentation.ts', 'storage.type.class.jsdoc'])
    ).toBe('comment')
  })

  it("takes the innermost scope a rule knows: a string's quote is string, a template's code is code", () => {
    expect(
      kindOf(['source.ts', 'string.quoted.single.ts', 'punctuation.definition.string.begin.ts'])
    ).toBe('str')
    expect(
      kindOf([
        'source.ts',
        'string.template.ts',
        'meta.template.expression.ts',
        'meta.embedded.line.ts',
        'variable.other.object.ts'
      ])
    ).toBe('var')
    expect(kindOf(['source.ts', 'meta.block.ts'])).toBe('plain')
  })
})

describe('tokenizeFile', () => {
  const { language, lines } = tokenizeFile(SOURCE, 'typescript')

  it('maps the grammar scopes of a TypeScript file to kinds', () => {
    expect(language).toBe('typescript')
    expect(kindAt(lines[0], 'import')).toBe('ctrl')
    expect(kindAt(lines[0], 'sign')).toBe('var')
    expect(kindAt(lines[0], "'./sign'")).toBe('str')
    expect(kindAt(lines[4], 'export')).toBe('ctrl')
    expect(kindAt(lines[4], 'async')).toBe('decl')
    expect(kindAt(lines[4], 'function')).toBe('decl')
    expect(kindAt(lines[4], 'put')).toBe('fn')
    expect(kindAt(lines[4], 'file')).toBe('var')
    expect(kindAt(lines[4], 'Blob')).toBe('type')
    expect(kindAt(lines[4], '3')).toBe('num')
    expect(kindAt(lines[5], 'const')).toBe('decl')
    expect(kindAt(lines[5], 'method')).toBe('prop')
    expect(kindAt(lines[6], 'if')).toBe('ctrl')
    expect(kindAt(lines[6], 'retries')).toBe('prop')
    expect(kindAt(lines[6], 'fetch')).toBe('fn')
    expect(kindAt(lines[7], 'new')).toBe('decl')
    expect(kindAt(lines[4], 'Promise')).toBe('type')
    expect(kindAt(lines[7], '// never')).toBe('comment')
  })

  it('colours a block comment on every line it spans', () => {
    expect(lines[2]?.every((t) => t.kind === 'comment')).toBe(true)
    expect(lines[3]?.every((t) => t.kind === 'comment')).toBe(true)
  })

  it("gives back each line's exact text, one token list per line", () => {
    expect(lines.map(text)).toEqual(SOURCE.split('\n').slice(0, -1))
    expect(lines[1]).toEqual([])
  })

  it('keeps tabs, trailing spaces and a carriage return', () => {
    const crlf = tokenizeFile('const a = 1;\t  \r\nlet b\r\n', 'typescript')

    expect(crlf.lines.map(text)).toEqual(['const a = 1;\t  \r', 'let b\r'])
  })

  it('gives an unknown language one plain token per line', () => {
    expect(tokenizeFile('alpha (beta)\n\ngamma\n', null)).toEqual({
      language: null,
      lines: [[{ text: 'alpha (beta)', kind: 'plain' }], [], [{ text: 'gamma', kind: 'plain' }]]
    })
  })
})

describe('bracket depth', () => {
  it('counts brackets through the file, a template ${} included, skipping strings and comments', () => {
    const { lines } = tokenizeFile(
      ['function f(a) {', "  const s = '(' + `[${a}]` // )", '  return [a]', '}', ''].join('\n'),
      'typescript'
    )

    const brackets = lines.map((l) =>
      l.filter((t) => t.depth !== undefined).map((t) => `${t.text}${t.depth}`)
    )

    expect(brackets).toEqual([['(0', ')0', '{0'], ['{1', '}1'], ['[1', ']1'], ['}0']])
    expect(lines[1]?.find((t) => t.text.includes("'('"))?.kind).toBe('str')
  })

  it('never goes below zero on a stray closing bracket, and leaves its input alone', () => {
    const input: DiffToken[][] = [[{ text: ')x(', kind: 'punct' }], [{ text: ')', kind: 'punct' }]]
    const before = structuredClone(input)

    expect(withBracketDepth(input)).toEqual([
      [
        { text: ')', kind: 'punct', depth: 0 },
        { text: 'x', kind: 'punct' },
        { text: '(', kind: 'punct', depth: 0 }
      ],
      [{ text: ')', kind: 'punct', depth: 0 }]
    ])
    expect(input).toEqual(before)
  })
})
