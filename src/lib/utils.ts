import type { KeyboardEvent } from "react"

export { cn } from "cn"

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

// keyCode 229 covers IME composition on browsers that do not set isComposing.
export function isSubmitEnter(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" &&
    !event.nativeEvent.isComposing &&
    event.keyCode !== 229
  )
}
