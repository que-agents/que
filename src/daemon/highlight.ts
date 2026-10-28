// Syntax tokens for a whole file: a grammar-based highlighter run with the
// JavaScript regex engine (no wasm to ship), its scopes mapped to que's few
// token kinds (syntax.ts), and brackets outside strings and comments given
// their nesting depth. Highlighting the whole file, not a patch's fragments,
// keeps block comments and multi-line strings right on every line.
//
// The kinds come from the scopes themselves: the highlighter is asked for each
// token's scope stack (`includeExplanation`) and `kindOf` reads it, so no theme
// is involved; the one theme loaded is an empty placeholder the API requires.
//
// This runs in the tokenizer worker (highlight-worker.ts), never on the
// daemon's main thread: loading a grammar and tokenizing are synchronous.
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
import type { DiffToken } from '../shared/protocol'
import { splitLines } from '../shared/diff-parse'
import {
  isTextual,
  kindOf,
  mergeTokens,
  plainLines,
  type TokenizedFile,
  withBracketDepth
} from './syntax'

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

/** Lines longer than this are not tokenized by the grammar (one plain token). */
const MAX_LINE_CHARS = 5_000

/** Files longer than this are not tokenized (every line plain). */
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

/**
 * Tokenizes a whole file, synchronously. Each line's token texts joined are
 * exactly that line (no newline); a line the highlighter disagrees with is one
 * plain token, and a highlighter failure makes the whole file plain.
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
