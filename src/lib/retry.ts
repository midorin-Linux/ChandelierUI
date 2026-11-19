import type { ChatMessage } from "../types/chat.ts"

/** The last message is the user's and nothing is running, so the reply is missing. */
export function awaitsReply(
  messages: readonly ChatMessage[],
  busy: boolean
): boolean {
  return !busy && messages[messages.length - 1]?.role === "user"
}
