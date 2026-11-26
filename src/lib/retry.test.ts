import assert from "node:assert/strict"
import { test } from "node:test"
import { awaitsReply, retryHead } from "./retry.ts"
import type { ChatMessage } from "../types/chat.ts"
import type { MessageNode } from "../types/session.ts"

test("awaitsReply", () => {
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
})

test("retryHead", () => {
  const node = (id: string, role: MessageNode["role"]): MessageNode => ({
    id,
    parent_id: null,
    role,
    content: id,
    created_at: 1,
  })
  const u1 = node("u1", "user")
  const a1 = node("a1", "assistant")
  const u2 = node("u2", "user")

  assert(retryHead([]) === null, "An empty path has nothing to resend")
  assert(retryHead([u1]) === "u1", "A trailing user message is the retry head")
  assert(retryHead([u1, a1]) === null, "A trailing reply is never resent")
  assert(retryHead([u1, a1, u2]) === "u2", "The last user message is resent")
})
