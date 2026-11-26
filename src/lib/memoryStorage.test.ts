import assert from "node:assert/strict"
import { test } from "node:test"
import { createMemoryStorage } from "./memoryStorage.ts"
import type { CompletionAttempt } from "../types/analysis.ts"
import type { SessionData } from "../types/session.ts"

const data = (content: string): SessionData => ({
  model: "m",
  reasoning_effort: "medium",
  system_prompt: "",
  messages: [
    { id: "u1", parent_id: null, role: "user", content, created_at: 1 },
  ],
  branches: { main: "u1" },
  current_branch: "main",
  provider_id: null,
})
const attempt = (id: number) => ({ id }) as CompletionAttempt

test("memory storage behaves like the backend", async () => {
  const store = createMemoryStorage()
  const a = await store.createSession(data("あ".repeat(100)))
  const b = await store.createSession(data("b"))
  assert([...a.title].length === 40, "Title is the first 40 characters")
  await store.appendAttempt(a.id, attempt(2))
  await store.appendAttempt(a.id, attempt(1))
  assert(
    (await store.listSessions())[0].id === a.id,
    "Appending an attempt moves the session to the top"
  )
  assert(
    (await store.loadSession(a.id)).attempts.map((x) => x.id).join() === "1,2",
    "Attempts load ordered by id"
  )
  let rejected = false
  await store.appendAttempt(a.id, attempt(1)).catch(() => (rejected = true))
  assert(rejected, "Duplicate attempt ids are rejected")
  await store.saveSession(b.id, data("changed"))
  assert(
    (await store.loadSession(b.id)).summary.title === "b",
    "Saving without a title keeps the title"
  )
  await store.deleteSession(a.id)
  assert(
    (await store.listSessions()).length === 1,
    "Delete removes the session"
  )
  await store.setSetting("k", 1)
  assert((await store.getSettings()).k === 1, "Settings round-trip")
})
