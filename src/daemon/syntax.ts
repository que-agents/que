// The highlighter-free half of syntax tokens: which language a path is, how a
// scope stack maps to a token kind, bracket depth, and the plain fallback. The
// daemon uses it directly; highlight.ts, run in the tokenizer worker, adds the
// grammars, so the daemon bundle never carries them.
import type { DiffToken, TokenKind } from '../shared/protocol'
import { splitLines } from './diff-parse'

export interface TokenizedFile {
  /** The language used, null when none (every token is then plain). */
  language: string | null
  /** One token list per line, in git's line numbering from 1 at index 0. */
  lines: DiffToken[][]
}

const BY_EXTENSION = new Map(
  Object.entries({
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'jsx',
    json: 'json',
    jsonc: 'jsonc',
    json5: 'jsonc',
    md: 'markdown',
    markdown: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    htm: 'html',
    py: 'python',
    pyi: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    hh: 'cpp',
    hpp: 'cpp',
    hxx: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    rake: 'ruby',
    gemspec: 'ruby',
    php: 'php',
    sh: 'shellscript',
    bash: 'shellscript',
    zsh: 'shellscript',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    dockerfile: 'docker',
    vue: 'vue',
    svelte: 'svelte',
    lua: 'lua'
  })
)

const BY_NAME = new Map(
  Object.entries({
    dockerfile: 'docker',
    containerfile: 'docker',
    gemfile: 'ruby',
    rakefile: 'ruby',
    '.bashrc': 'shellscript',
    '.zshrc': 'shellscript',
    '.profile': 'shellscript'
  })
)

/** The highlighter language for a path, by file name then extension; null when none fits. */
export function languageFor(path: string): string | null {
  const name = (path.split('/').at(-1) ?? '').toLowerCase()
  const byName = BY_NAME.get(name)

  if (byName) return byName

  // JSON files that tools read with comments allowed.
  if (/^(tsconfig|jsconfig)(\..*)?\.json$/.test(name)) return 'jsonc'
  const dot = name.lastIndexOf('.')

  if (dot <= 0) return null

  return BY_EXTENSION.get(name.slice(dot + 1)) ?? null
}

/** Scope prefixes in priority order; the innermost scope that matches one decides. */
const RULES: ReadonlyArray<readonly [string, TokenKind]> = [
  ['punctuation.definition.string', 'str'],
  ['string', 'str'],
  ['constant.numeric', 'num'],
  ['constant.language', 'decl'],
  ['keyword.control', 'ctrl'],
  ['keyword.operator.new', 'decl'],
  ['keyword.operator.expression', 'decl'],
  ['storage.type.function.arrow', 'punct'],
  ['storage.type.primitive', 'type'],
  ['support.type.primitive', 'type'],
  ['support.type.property-name', 'prop'],
  ['storage.type', 'decl'],
  ['storage.modifier', 'decl'],
  ['variable.language', 'decl'],
  ['entity.name.function', 'fn'],
  ['support.function', 'fn'],
  ['meta.function-call', 'fn'],
  ['entity.name.type', 'type'],
  ['entity.name.class', 'type'],
  ['entity.name.namespace', 'type'],
  ['entity.name.tag', 'type'],
  ['entity.other.inherited-class', 'type'],
  ['support.type', 'type'],
  ['support.class', 'type'],
  ['entity.other.attribute-name', 'prop'],
  ['variable.other.property', 'prop'],
  ['variable.other.object.property', 'prop'],
  ['meta.object-literal.key', 'prop'],
  ['support.variable.property', 'prop'],
  ['variable', 'var'],
  ['punctuation', 'punct'],
  ['keyword.operator', 'punct'],
  ['meta.brace', 'punct'],
  ['keyword', 'ctrl']
]

const matches = (scope: string, prefix: string): boolean =>
  scope === prefix || scope.startsWith(`${prefix}.`)

/**
 * The kind of a token from its scope stack, outermost first. Anything inside a
 * comment is a comment; otherwise the innermost scope a rule knows decides, so
 * a string's quotes are string and a template's `${…}` code is code.
 */
export function kindOf(scopes: readonly string[]): TokenKind {
  if (scopes.some((s) => matches(s, 'comment'))) return 'comment'

  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i] ?? ''

    for (const [prefix, kind] of RULES) if (matches(scope, prefix)) return kind
  }

  return 'plain'
}

export const isTextual = (kind: TokenKind): boolean => kind === 'str' || kind === 'comment'

/** Adjacent tokens of one kind (no depth, no mark) joined; empty ones dropped. */
export function mergeTokens(tokens: readonly DiffToken[]): DiffToken[] {
  const out: DiffToken[] = []

  for (const t of tokens) {
    if (t.text === '') continue
    const last = out.at(-1)

    if (
      last &&
      last.kind === t.kind &&
      last.depth === undefined &&
      t.depth === undefined &&
      last.mark === t.mark
    ) {
      out[out.length - 1] = { ...last, text: last.text + t.text }
    } else {
      out.push({ ...t })
    }
  }

  return out
}

const OPEN = '([{'
const CLOSE = ')]}'

/**
 * Splits every bracket outside strings and comments into its own punct token
 * with its nesting depth, counted through the whole file: an opening bracket
 * takes the depth before it opens, a closing one the depth after it closes,
 * never below 0. Returns new arrays; the input is untouched.
 */
export function withBracketDepth(lines: readonly DiffToken[][]): DiffToken[][] {
  let depth = 0

  return lines.map((tokens) => {
    const out: DiffToken[] = []

    for (const t of tokens) {
      if (isTextual(t.kind) || !/[()[\]{}]/.test(t.text)) {
        out.push({ ...t })
        continue
      }

      let run = ''

      for (const ch of t.text) {
        const opens = OPEN.includes(ch)
        const closes = CLOSE.includes(ch)

        if (!opens && !closes) {
          run += ch
          continue
        }

        if (run !== '') out.push({ ...t, text: run })
        run = ''

        if (opens) {
          out.push({ text: ch, kind: 'punct', depth })
          depth += 1
        } else {
          depth = Math.max(0, depth - 1)
          out.push({ text: ch, kind: 'punct', depth })
        }
      }

      if (run !== '') out.push({ ...t, text: run })
    }

    return out
  })
}

/** Each line as one plain token (none for an empty line). */
export const plainLines = (lines: readonly string[]): DiffToken[][] =>
  lines.map((text) => (text === '' ? [] : [{ text, kind: 'plain' }]))

/** A whole file untokenized: one plain token per line, no language. */
export function plainFile(text: string): TokenizedFile {
  return { language: null, lines: plainLines(splitLines(text)) }
}
