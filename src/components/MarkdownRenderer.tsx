import { memo } from "react"
import { Streamdown, type Components } from "streamdown"
import { openUrl } from "@tauri-apps/plugin-opener"
import "katex/dist/katex.min.css"
import { normalizeMathDelimiters } from "../lib/normalizeMathDelimiters"
import { code } from "@/src/lib/codeHighlighter"
import { rehypePlugins, remarkPlugins, urlTransform } from "@/src/lib/markdown"

const plugins = { code }
// A blob download does nothing useful in the WebView; copy stays.
const controls = { code: { download: false } }

const components: Components = {
  // Plain tags: `.markdown-body` in App.css styles them, not Streamdown's defaults.
  // Code blocks keep Streamdown's renderer (highlighting and copy button).
  p: "p",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  ul: "ul",
  ol: "ol",
  li: "li",
  strong: "strong",
  blockquote: "blockquote",
  hr: "hr",
  thead: "thead",
  tbody: "tbody",
  tr: "tr",
  th: "th",
  td: "td",
  sup: "sup",
  sub: "sub",
  section: "section",
  a: ({ href, children }) =>
    href ? (
      <a
        href={href}
        onClick={(event) => {
          // Never navigate the WebView; hand the URL to the OS browser.
          event.preventDefault()
          openUrl(href).catch(() => {})
        }}
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // Remote images would leak requests; show alt text instead.
  img: ({ alt }) => (
    <span role="img" aria-label={alt || "image"} data-slot="markdown-image">
      [image{alt ? `: ${alt}` : ""}]
    </span>
  ),
  table: ({ children }) => (
    <div className="markdown-table">
      <table>{children}</table>
    </div>
  ),
}

/** `streaming` repairs unfinished Markdown and re-renders only the last block; set it only on the reply being received. */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  streaming = false,
}: {
  content: string
  streaming?: boolean
}) {
  return (
    <Streamdown
      className="markdown-body"
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      plugins={plugins}
      controls={controls}
      lineNumbers={false}
      codeBlockMaxHeight={0}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      urlTransform={urlTransform}
      components={components}
    >
      {normalizeMathDelimiters(content)}
    </Streamdown>
  )
})
