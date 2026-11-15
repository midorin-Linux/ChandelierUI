import { createServer } from "vite"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

// Load the real TSX component through Vite (honours the "@/" alias).
const server = await createServer({
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: { tsconfigPaths: true },
  logLevel: "silent",
})
try {
  const { MarkdownRenderer } = (await server.ssrLoadModule(
    "/src/components/MarkdownRenderer.tsx"
  )) as typeof import("../components/MarkdownRenderer.tsx")
  const { urlTransform } = (await server.ssrLoadModule(
    "/src/lib/markdown.ts"
  )) as typeof import("./markdown.ts")
  const render = (content: string) =>
    renderToStaticMarkup(createElement(MarkdownRenderer, { content }))

  // Rendering
  const rich = render(
    "# T\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> q\n\n~~s~~\n\n```ts\nconst x = 1\n```"
  )
  assert(rich.includes("<h1>"), "heading")
  assert(rich.includes('type="checkbox"'), "task list")
  assert(rich.includes('class="markdown-table"'), "table wrapper")
  assert(rich.includes("<blockquote>") && rich.includes("<del>"), "quote/strike")
  assert(rich.includes("hljs-keyword"), "labeled code highlighted")
  assert(!render("```\nconst x = 1\n```").includes("hljs-"), "no auto-detect")

  // Security
  const html = render('<script>alert(1)</script><img src=x onerror="alert(1)">hi')
  assert(!/<script|<img|onerror/i.test(html), "raw HTML is not rendered")
  const js = render("[x](javascript:alert(1))")
  assert(!js.includes("javascript:") && !js.includes("href"), "javascript: stripped")
  assert(!render("[x](data:text/html,hi)").includes("href"), "data: stripped")
  assert(!render("[x](/rel)").includes("href"), "relative stripped")
  assert(render("[x](https://a.test)").includes('href="https://a.test"'), "https ok")
  assert(render("[x](mailto:a@b.test)").includes("mailto:a@b.test"), "mailto ok")
  assert(urlTransform("java\nscript:alert(1)") === "", "control-char scheme")
  const img = render("![cat](https://evil.test/p.png)")
  assert(!img.includes("<img") && !img.includes("evil.test"), "images not loaded")
  assert(img.includes("cat"), "image alt shown")

  // Incomplete / streaming input must not throw
  for (const partial of ["```ts\nconst x =", "| a | b |\n|---", "**bold", "[x](http", "```unknownlang\nfoo"]) {
    render(partial)
  }
  assert(render("```ts\nconst x =").includes("<pre>"), "unclosed fence renders")
} finally {
  await server.close()
}
