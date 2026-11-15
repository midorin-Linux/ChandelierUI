import { defaultUrlTransform } from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"
import type { Options } from "react-markdown"

// LLM output is untrusted: only these schemes may survive in href/src.
const allowedUrl = /^(https?:|mailto:)/i

export function urlTransform(url: string): string {
  const safe = defaultUrlTransform(url)
  // Relative URLs are dropped too: they would navigate the WebView.
  return allowedUrl.test(safe) ? safe : ""
}

// Defined once so react-markdown receives stable references on every render.
export const remarkPlugins: NonNullable<Options["remarkPlugins"]> = [remarkGfm]
export const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [
  // detect: no guessing for unlabeled fences; ignoreMissing: unknown labels
  // must not throw while a response is still streaming.
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
]
