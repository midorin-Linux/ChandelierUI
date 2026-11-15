import { defaultUrlTransform } from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import rehypeKatex from "rehype-katex"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import type { Options } from "react-markdown"

// LLM output is untrusted: only these schemes may survive in href/src.
const allowedUrl = /^(https?:|mailto:)/i

export function urlTransform(url: string): string {
  const safe = defaultUrlTransform(url)
  // Relative URLs are dropped too: they would navigate the WebView.
  return allowedUrl.test(safe) ? safe : ""
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

// Defined once so react-markdown receives stable references on every render.
export const remarkPlugins: NonNullable<Options["remarkPlugins"]> = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: true }],
]
export const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [
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
  // detect: no guessing for unlabeled fences; ignoreMissing: unknown labels
  // must not throw while a response is still streaming.
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
]
