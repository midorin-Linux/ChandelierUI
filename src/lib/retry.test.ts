import { awaitsReply } from "./retry.ts"
import type { ChatMessage } from "../types/chat.ts"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const user: ChatMessage = { role: "user", content: "hi" }
const assistant: ChatMessage = { role: "assistant", content: "hello" }

assert(!awaitsReply([], false), "An empty chat has nothing to retry")
assert(awaitsReply([user], false), "A trailing user message awaits a reply")
assert(
  awaitsReply([user, assistant, user], false),
  "Only the last message decides"
)
assert(!awaitsReply([user, assistant], false), "A reply was received")
assert(
  !awaitsReply([user], true),
  "Nothing awaits a reply while sending, switching or restoring"
)
