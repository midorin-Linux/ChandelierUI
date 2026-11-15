import { memo } from "react"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
import { openUrl } from "@tauri-apps/plugin-opener"
import {
  rehypePlugins,
  remarkPlugins,
  urlTransform,
} from "@/src/lib/markdown"

// Extension point: add e.g. a copy-button `pre` here later.
const components: Components = {
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

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
}: {
  content: string
}) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        skipHtml
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
