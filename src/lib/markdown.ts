import rehypeKatex from "rehype-katex"
import remarkMath from "remark-math"
import { defaultRemarkPlugins, type StreamdownProps } from "streamdown"

// LLM output is untrusted: only these schemes may survive in href/src.
// Relative URLs are dropped too: they would navigate the WebView.
const allowedUrl = /^(https?:|mailto:)/i

export function urlTransform(url: string): string {
  return allowedUrl.test(url) ? url : ""
}

interface MarkdownNode {
  type: string
  tagName?: string
  properties?: { className?: unknown }
  children?: MarkdownNode[]
}

function rehypeProtectMathCode() {
  return (tree: MarkdownNode) => {
    function protect(node: MarkdownNode): void {
      if (
        node.type === "element" &&
        node.tagName === "code" &&
        node.properties
      ) {
        const classes = node.properties.className
        // KaTeX also claims ```math fences; only remark-math nodes are math.
        if (
          Array.isArray(classes) &&
          classes.includes("language-math") &&
          !classes.includes("math-inline") &&
          !classes.includes("math-display")
        ) {
          node.properties.className = classes.filter(
            (name) => name !== "language-math"
          )
        }
      }
      node.children?.forEach(protect)
    }
    protect(tree)
  }
}

// Defined once so Streamdown receives stable references on every render.
// Streamdown's defaults are GFM plus code-fence metadata.
export const remarkPlugins: NonNullable<StreamdownProps["remarkPlugins"]> = [
  ...Object.values(defaultRemarkPlugins),
  [remarkMath, { singleDollarTextMath: true }],
]
// Replaces Streamdown's rehype-raw/sanitize/harden defaults: without rehype-raw,
// raw HTML stays literal text, and `urlTransform` filters every URL attribute.
export const rehypePlugins: NonNullable<StreamdownProps["rehypePlugins"]> = [
  rehypeProtectMathCode,
  // rehype-katex catches parse errors and retries with throwOnError: false.
  [
    rehypeKatex,
    {
      strict: "ignore",
      trust: false,
      maxSize: 10,
      maxExpand: 1000,
      errorColor: "var(--destructive)",
    },
  ],
]
