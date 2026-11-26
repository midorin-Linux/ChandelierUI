import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createServer, type ViteDevServer } from "vite"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

let server: ViteDevServer
let render: (content: string) => string
let urlTransform: typeof import("./markdown.ts").urlTransform

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
  render = (content) =>
    renderToStaticMarkup(createElement(MarkdownRenderer, { content }))
})
after(() => server?.close())

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
  assert(rich.includes("hljs-keyword"), "labeled code highlighted")
  assert(!render("```\nconst x = 1\n```").includes("hljs-"), "no auto-detect")
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
    assert(!math.includes("hljs"), "math is not syntax highlighted")
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
    inlineCode.includes(`<code>${escapedMath}</code>`),
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
      /<pre><code[^>]*>/.test(code) &&
        code.includes(`${escapedMath}\n</code></pre>`),
      `fenced ${language || "plain"} code contents unchanged`
    )
  }
  const indentedCode = render("    " + literalMath)
  assert(!indentedCode.includes("katex"), "indented code is not math")
  assert(
    indentedCode.includes(`${escapedMath}\n</code></pre>`),
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
  // Security
  const html = render(
    '<script>alert(1)</script><img src=x onerror="alert(1)">hi'
  )
  assert(!/<script|<img|onerror/i.test(html), "raw HTML is not rendered")
  const js = render("[x](javascript:alert(1))")
  assert(
    !js.includes("javascript:") && !js.includes("href"),
    "javascript: stripped"
  )
  assert(!render("[x](data:text/html,hi)").includes("href"), "data: stripped")
  assert(!render("[x](/rel)").includes("href"), "relative stripped")
  assert(
    render("[x](https://a.test)").includes('href="https://a.test"'),
    "https ok"
  )
  assert(
    render("[x](mailto:a@b.test)").includes("mailto:a@b.test"),
    "mailto ok"
  )
  assert(urlTransform("java\nscript:alert(1)") === "", "control-char scheme")
  const img = render("![cat](https://evil.test/p.png)")
  assert(
    !img.includes("<img") && !img.includes("evil.test"),
    "images not loaded"
  )
  assert(img.includes("cat"), "image alt shown")
  const unsafeMath = render(
    String.raw`$\href{https://evil.test}{open}+\href{javascript:alert(1)}{run}+\includegraphics{https://evil.test/p.png}$`
  )
  assert(
    !/<a\b|<img\b|\b(?:href|src)=/i.test(unsafeMath),
    "math cannot create links or images"
  )
  assert(
    !render(String.raw`$\global\def\leaked{\text{secret}}$ $\leaked$`).includes(
      "<mtext>secret</mtext>"
    ),
    "no cross-expression macro state"
  )
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
  }
  assert(render("```ts\nconst x =").includes("<pre>"), "unclosed fence renders")
  for (const partial of [
    "$",
    "$x",
    "$$",
    "$$\nx + 1",
    "Before $$x + 1\n\nFollowing prose",
    String.raw`\[x + 1`,
    String.raw`\(x + 1`,
  ]) {
    const streamed = render(partial)
    assert(
      !streamed.includes("katex"),
      `incomplete math stays literal: ${partial}`
    )
  }
  assert(
    render("Before $$x + 1\n\nFollowing prose").includes(
      "<p>Following prose</p>"
    ),
    "incomplete display math does not swallow following prose"
  )
})
