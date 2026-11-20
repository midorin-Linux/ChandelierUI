import type { ChatMessage } from "../types/chat.ts"
import type { MessageNode } from "../types/session.ts"

/** The last message is the user's and nothing is running, so the reply is missing. */
export function awaitsReply(
  messages: readonly ChatMessage[],
  busy: boolean
): boolean {
  return !busy && messages[messages.length - 1]?.role === "user"
}

/** The id to resend from: the last message on the path if it is a user message, otherwise null. */
export function retryHead(messages: readonly MessageNode[]): string | null {
  const last = messages[messages.length - 1]
  return last?.role === "user" ? last.id : null
}
