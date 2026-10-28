// Syntax tokens for a whole file: a grammar-based highlighter run with the
// JavaScript regex engine (no wasm to ship), its scopes mapped to que's few
// token kinds, and brackets outside strings and comments given their nesting
// depth. Highlighting the whole file, not a patch's fragments, keeps block
// comments and multi-line strings right on every line.
//
// The kinds come from the scopes themselves: the highlighter is asked for each
// token's scope stack (`includeExplanation`) and `kindOf` reads it, so no theme
// is involved; the one theme loaded is an empty placeholder the API requires.
import { createHighlighterCoreSync, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import c from 'shiki/langs/c.mjs'
import cpp from 'shiki/langs/cpp.mjs'
import csharp from 'shiki/langs/csharp.mjs'
import css from 'shiki/langs/css.mjs'
import docker from 'shiki/langs/docker.mjs'
import go from 'shiki/langs/go.mjs'
import html from 'shiki/langs/html.mjs'
import java from 'shiki/langs/java.mjs'
import javascript from 'shiki/langs/javascript.mjs'
import json from 'shiki/langs/json.mjs'
import jsonc from 'shiki/langs/jsonc.mjs'
import jsx from 'shiki/langs/jsx.mjs'
import kotlin from 'shiki/langs/kotlin.mjs'
import lua from 'shiki/langs/lua.mjs'
import markdown from 'shiki/langs/markdown.mjs'
import php from 'shiki/langs/php.mjs'
import python from 'shiki/langs/python.mjs'
import ruby from 'shiki/langs/ruby.mjs'
import rust from 'shiki/langs/rust.mjs'
import scss from 'shiki/langs/scss.mjs'
import shellscript from 'shiki/langs/shellscript.mjs'
import sql from 'shiki/langs/sql.mjs'
import svelte from 'shiki/langs/svelte.mjs'
import swift from 'shiki/langs/swift.mjs'
import toml from 'shiki/langs/toml.mjs'
import tsx from 'shiki/langs/tsx.mjs'
import typescript from 'shiki/langs/typescript.mjs'
import vue from 'shiki/langs/vue.mjs'
import yaml from 'shiki/langs/yaml.mjs'
import type { DiffToken, TokenKind } from '../shared/protocol'
import { splitLines } from './diff-parse'

/** Each language's grammar (with the grammars it embeds), loaded the first time a file needs it. */
const GRAMMARS = new Map(
  Object.entries({
    c,
    cpp,
    csharp,
    css,
    docker,
    go,
    html,
    java,
    javascript,
    json,
    jsonc,
    jsx,
    kotlin,
    lua,
    markdown,
    php,
    python,
    ruby,
    rust,
    scss,
    shellscript,
    sql,
    svelte,
    swift,
    toml,
    tsx,
    typescript,
    vue,
    yaml
  })
)

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

const isTextual = (kind: TokenKind): boolean => kind === 'str' || kind === 'comment'

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

const plainLines = (lines: readonly string[]): DiffToken[][] =>
  lines.map((text) => (text === '' ? [] : [{ text, kind: 'plain' }]))

/** Lines longer than this are not tokenized by the grammar (one plain token). */
const MAX_LINE_CHARS = 5_000

/** Files longer than this are not tokenized (every line plain): tokenizing is synchronous. */
export const MAX_FILE_CHARS = 1_000_000

const PLACEHOLDER_THEME = {
  name: 'que-scopes',
  type: 'dark' as const,
  settings: [],
  fg: '#000000',
  bg: '#ffffff'
}

let highlighter: HighlighterCore | null = null
const loaded = new Set<string>()

function grammarFor(language: string): HighlighterCore {
  highlighter ??= createHighlighterCoreSync({
    themes: [PLACEHOLDER_THEME],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true })
  })

  if (!loaded.has(language)) {
    highlighter.loadLanguageSync(GRAMMARS.get(language) ?? [])
    loaded.add(language)
  }

  return highlighter
}

export interface TokenizedFile {
  /** The language used, null when none (every token is then plain). */
  language: string | null
  /** One token list per line, in git's line numbering from 1 at index 0. */
  lines: DiffToken[][]
}

/**
 * Tokenizes a whole file. Each line's token texts joined are exactly that
 * line (no newline); a line the highlighter disagrees with is one plain
 * token, and a highlighter failure makes the whole file plain.
 */
export function tokenizeFile(text: string, language: string | null): TokenizedFile {
  const lines = splitLines(text)

  if (language === null || !GRAMMARS.has(language) || text.length > MAX_FILE_CHARS) {
    return { language: null, lines: plainLines(lines) }
  }

  let raw: ReturnType<HighlighterCore['codeToTokensBase']>

  try {
    raw = grammarFor(language).codeToTokensBase(text, {
      lang: language,
      theme: PLACEHOLDER_THEME.name,
      includeExplanation: 'scopeName',
      tokenizeMaxLineLength: MAX_LINE_CHARS
    })
  } catch {
    return { language: null, lines: plainLines(lines) }
  }

  const tokenized = lines.map((line, i): DiffToken[] => {
    const pieces: DiffToken[] = []

    for (const token of raw[i] ?? []) {
      const explained = token.explanation ?? [{ content: token.content, scopes: [] }]

      for (const e of explained) {
        const kind = kindOf(e.scopes.map((s) => s.scopeName))
        const blank = e.content.trim() === ''
        pieces.push({ text: e.content, kind: blank && !isTextual(kind) ? 'plain' : kind })
      }
    }

    const joined = pieces.map((p) => p.text).join('')

    // The highlighter splits on \r\n too: give a carriage return back as plain text.
    if (joined !== line && line === `${joined}\r`) pieces.push({ text: '\r', kind: 'plain' })
    else if (joined !== line) return line === '' ? [] : [{ text: line, kind: 'plain' }]

    return mergeTokens(pieces)
  })

  return { language, lines: withBracketDepth(tokenized) }
}
