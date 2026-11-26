import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageInput,
  type TokensResult,
} from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"
import type { CodeHighlighterPlugin } from "streamdown"

// ponytail: a curated set keeps the bundle small; add a line to support another language.
const languages: Record<string, LanguageInput> = {
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
}

const aliases: Record<string, string> = {
  bash: "shellscript",
  "c#": "csharp",
  "c++": "cpp",
  cs: "csharp",
  golang: "go",
  js: "javascript",
  kt: "kotlin",
  md: "markdown",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shellscript",
  shell: "shellscript",
  ts: "typescript",
  yml: "yaml",
  zsh: "shellscript",
}

const themes = { light: "github-light", dark: "github-dark" }

const idOf = (language: string) => {
  const id = language.trim().toLowerCase()
  return aliases[id] ?? id
}
const supported = (id: string) =>
  Object.prototype.hasOwnProperty.call(languages, id)

let highlighter: Promise<HighlighterCore> | undefined
// JavaScript regex engine: no WebAssembly, which the app's CSP does not allow.
const getHighlighter = () =>
  (highlighter ??= createHighlighterCore({
    themes: [
      import("shiki/themes/github-light.mjs"),
      import("shiki/themes/github-dark.mjs"),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  }))

// Finished blocks only; a block still streaming is superseded by its next update.
const cache = new Map<string, TokensResult>()
function remember(key: string, result: TokensResult) {
  cache.set(key, result)
  // ponytail: oldest-first eviction by count, not size.
  if (cache.size > 500) cache.delete(cache.keys().next().value!)
}

/** Shiki for Streamdown, limited to the languages above; anything else is plain text. */
export const code: CodeHighlighterPlugin = {
  name: "shiki",
  type: "code-highlighter",
  getSupportedLanguages: () => Object.keys(languages),
  getThemes: () => [themes.light, themes.dark],
  supportsLanguage: (language) => supported(idOf(language)),
  highlight({ code, language, isIncomplete }, callback) {
    const id = idOf(language)
    const lang = supported(id) ? id : "text"
    const key = `${lang}\n${code}`
    const cached = cache.get(key)
    if (cached) return cached
    void (async () => {
      const shiki = await getHighlighter()
      if (lang !== "text" && !shiki.getLoadedLanguages().includes(lang))
        await shiki.loadLanguage(languages[lang])
      const result = shiki.codeToTokens(code, { lang, themes })
      if (!isIncomplete) remember(key, result)
      callback?.(result)
    })().catch((cause) => console.error("Code highlighting failed:", cause))
    return null
  },
}
