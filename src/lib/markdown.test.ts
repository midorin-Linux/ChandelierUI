import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createServer, type ViteDevServer } from "vite"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

let server: ViteDevServer
let render: (content: string, streaming?: boolean) => string
let urlTransform: typeof import("./markdown.ts").urlTransform
let code: typeof import("./codeHighlighter.ts").code

// Load the real TSX component through Vite (honours the "@/" alias).
before(async () => {
  server = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true },
    resolve: { tsconfigPaths: true },
    logLevel: "silent",
  })
  const { MarkdownRenderer } = (await server.ssrLoadModule(
    "/src/components/MarkdownRenderer.tsx"
  )) as typeof import("../components/MarkdownRenderer.tsx")
  ;({ urlTransform } = (await server.ssrLoadModule(
    "/src/lib/markdown.ts"
  )) as typeof import("./markdown.ts"))
  ;({ code } = (await server.ssrLoadModule(
    "/src/lib/codeHighlighter.ts"
  )) as typeof import("./codeHighlighter.ts"))
  render = (content, streaming) =>
    renderToStaticMarkup(
      createElement(MarkdownRenderer, { content, streaming })
    )
})
after(() => server?.close())

// Streamdown's code block: highlighted tokens arrive later, plain lines first.
const codeBlockWith = (html: string, text: string) =>
  html.includes('data-streamdown="code-block"') &&
  html.includes(`>${text}</span></span></code></pre>`)

test("rendering", () => {
  // Rendering
  const rich = render(
    "# T\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> q\n\n~~s~~\n\n```ts\nconst x = 1\n```"
  )
  assert(rich.includes("<h1>"), "heading")
  assert(rich.includes('type="checkbox"'), "task list")
  assert(rich.includes('class="markdown-table"'), "table wrapper")
  assert(
    rich.includes("<blockquote>") && rich.includes("<del>"),
    "quote/strike"
  )
  assert(
    codeBlockWith(rich, "const x = 1") && rich.includes('data-language="ts"'),
    "code block with language"
  )
  assert(
    rich.includes('data-streamdown="code-block-copy-button"') &&
      !rich.includes("code-block-download-button"),
    "code copy, no download"
  )
})

// A failed highlight only logs, so the timeout is the failure.
test("code highlighting", { timeout: 10_000 }, async (t) => {
  // Shiki's JavaScript regex engine: the app's CSP allows no WebAssembly.
  const { WebAssembly } = globalThis
  t.after(() => void Object.assign(globalThis, { WebAssembly }))
  Object.assign(globalThis, { WebAssembly: undefined })
  const result = await new Promise<
    NonNullable<ReturnType<typeof code.highlight>>
  >((resolve) => {
    const cached = code.highlight(
      { code: "const x = 1", language: "ts", themes: code.getThemes() },
      resolve
    )
    if (cached) resolve(cached)
  })
  const colors = new Set(
    result.tokens.flat().map((token) => token.htmlStyle?.color)
  )
  assert(colors.size > 1, "labeled code highlighted")
  assert(
    code.supportsLanguage("ts") && !code.supportsLanguage(""),
    "aliases resolve; unlabeled fences are not guessed"
  )
})

test("math", () => {
  // The real pipeline renders both LLM delimiter styles, not code lookalikes.
  for (const source of ["$x^2$", String.raw`\(x^2\)`]) {
    const math = render(`Before ${source} after`)
    assert(math.includes('class="katex"'), `inline math: ${source}`)
    assert(
      !math.includes("katex-display"),
      `inline math stays inline: ${source}`
    )
    assert(
      math.includes("<math") && math.includes("katex-html"),
      "accessible math and visual output"
    )
    assert(!math.includes("code-block"), "math is not a code block")
  }
  for (const source of ["$$\nx^2\n$$", String.raw`\[x^2\]`, "$$x^2$$"]) {
    const math = render(source)
    assert(math.includes('class="katex-display"'), `display math: ${source}`)
  }
  const embeddedDisplay = render("Before $$x^2$$ after")
  assert(
    /<p>Before<\/p>\s*<span class="katex-display"/.test(embeddedDisplay) &&
      embeddedDisplay.endsWith("<p>after</p></div>"),
    "same-line double dollars become a separate display block"
  )
  const literalMath = String.raw`$x$ $$x$$ \(x\) \[x\] <tag>`
  const escapedMath = literalMath.replace("<tag>", "&lt;tag&gt;")
  const inlineCode = render("`" + literalMath + "`")
  assert(
    /<code[^>]*>/.test(inlineCode) &&
      inlineCode.includes(`>${escapedMath}</code>`),
    "inline code contents unchanged"
  )
  assert(!inlineCode.includes("katex"), "inline code is not math")
  for (const language of [
    "",
    "math",
    "language-math",
    "math-inline",
    "math-display",
  ]) {
    const code = render("```" + language + "\n" + literalMath + "\n```")
    assert(
      !code.includes("katex"),
      `fenced ${language || "plain"} code is not math`
    )
    assert(
      codeBlockWith(code, escapedMath),
      `fenced ${language || "plain"} code contents unchanged`
    )
  }
  const indentedCode = render("    " + literalMath)
  assert(!indentedCode.includes("katex"), "indented code is not math")
  assert(
    codeBlockWith(indentedCode, escapedMath),
    "indented code contents unchanged"
  )
  const currency = render("Costs $5 and $10.")
  assert(
    !currency.includes("katex") && currency.includes("$5 and $10"),
    "currency stays literal"
  )
  assert(
    !render(String.raw`Escaped \$x\$`).includes("katex"),
    "escaped dollars stay literal"
  )

  const invalidMath = render(String.raw`$\frac{1}{$`)
  assert(
    invalidMath.includes('class="katex-error"'),
    "invalid expression has error class"
  )
  assert(
    invalidMath.includes('style="color:var(--destructive)"'),
    "math error uses theme color"
  )
  const recursiveMath = render(String.raw`$\def\loop{\loop}\loop$`)
  assert(
    recursiveMath.includes('class="katex-error"') &&
      recursiveMath.includes("Too many expansions"),
    "recursive macros stop at the expansion budget"
  )
  const hugeMath = render(String.raw`$\rule{1000em}{1000em}$`)
  assert(
    !hugeMath.includes("katex-error"),
    "oversized dimensions render safely"
  )
  assert(
    hugeMath.includes("border-right-width:10em") &&
      hugeMath.includes("border-top-width:10em") &&
      !/style="[^"]*1000em/.test(hugeMath),
    "rule dimensions are capped at ten em"
  )
})

test("security", () => {
  // Security, for finished and streaming (remend-repaired) messages
  for (const streaming of [false, true]) {
    const show = (content: string) => render(content, streaming)
    const html = show(
      '<script>alert(1)</script><img src=x onerror="alert(1)">hi'
    )
    // Without rehype-raw, Streamdown keeps raw HTML as escaped text.
    assert(
      !/<script|<img/i.test(html) && html.includes("&lt;script&gt;"),
      "raw HTML is not rendered"
    )
    const js = show("[x](javascript:alert(1))")
    assert(
      !js.includes("javascript:") && !js.includes("href"),
      "javascript: stripped"
    )
    assert(!show("[x](data:text/html,hi)").includes("href"), "data: stripped")
    assert(!show("[x](/rel)").includes("href"), "relative stripped")
    assert(
      show("[x](https://a.test)").includes('href="https://a.test"'),
      "https ok"
    )
    assert(
      show("[x](mailto:a@b.test)").includes("mailto:a@b.test"),
      "mailto ok"
    )
    assert(urlTransform("java\nscript:alert(1)") === "", "control-char scheme")
    const img = show("![cat](https://evil.test/p.png)")
    assert(
      !img.includes("<img") && !img.includes("evil.test"),
      "images not loaded"
    )
    assert(img.includes("cat"), "image alt shown")
    const unsafeMath = show(
      String.raw`$\href{https://evil.test}{open}+\href{javascript:alert(1)}{run}+\includegraphics{https://evil.test/p.png}$`
    )
    assert(
      !/<a\b|<img\b|\b(?:href|src)=/i.test(unsafeMath),
      "math cannot create links or images"
    )
    assert(
      !show(String.raw`$\global\def\leaked{\text{secret}}$ $\leaked$`).includes(
        "<mtext>secret</mtext>"
      ),
      "no cross-expression macro state"
    )
    const partialImage = show("![a](https://x")
    assert(
      !partialImage.includes("<img") &&
        (!streaming || !partialImage.includes("https://x")),
      "unfinished image not loaded"
    )
  }
})

test("incomplete or streaming input does not throw", () => {
  // Incomplete / streaming input must not throw
  for (const partial of [
    "```ts\nconst x =",
    "| a | b |\n|---",
    "**bold",
    "[x](http",
    "```unknownlang\nfoo",
  ]) {
    render(partial)
    render(partial, true)
  }
  assert(
    codeBlockWith(render("```ts\nconst x =", true), "const x ="),
    "unclosed fence renders"
  )
  assert(
    render("**bold", true).includes("<strong>bold</strong>"),
    "streaming repairs unfinished emphasis"
  )
  assert(
    render("[x](http", true).includes("<span>x</span>"),
    "streaming hides an unfinished link target"
  )
  for (const partial of [
    "$",
    "$x",
    "$$",
    "$$\nx + 1",
    "Before $$x + 1\n\nFollowing prose",
    String.raw`\[x + 1`,
    String.raw`\(x + 1`,
  ]) {
    for (const streaming of [false, true]) {
      assert(
        !render(partial, streaming).includes("katex"),
        `incomplete math stays literal: ${partial}`
      )
    }
  }
  assert(
    render("Before $$x + 1\n\nFollowing prose").includes(
      "<p>Following prose</p>"
    ),
    "incomplete display math does not swallow following prose"
  )
})
