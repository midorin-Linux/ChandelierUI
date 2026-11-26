import { createMemoryStorage } from "./memoryStorage.ts"
import { createSessionStore } from "./sessionStore.ts"
import type { SessionDefaults } from "../types/chat.ts"
import type { MessageNode } from "../types/session.ts"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const defaults: SessionDefaults = {
  providerId: null,
  effort: "off",
  model: "",
  systemPrompt: "",
}
const node = (content: string): MessageNode => ({
  id: crypto.randomUUID(),
  parent_id: null,
  role: "user",
  content,
  created_at: Date.now(),
})

const storage = createMemoryStorage()
let failNextSave = false
const saveSession = storage.saveSession
storage.saveSession = (...args) => {
  if (!failNextSave) return saveSession(...args)
  failNextSave = false
  return Promise.reject(new Error("disk full"))
}
const errors: unknown[] = []
const activated: (string | null)[] = []
const session = createSessionStore(
  storage,
  {
    onError: (cause) => errors.push(cause),
    onActivate: (id) => activated.push(id),
    defaults: () => defaults,
  },
  60_000 // never fires during the test: only flush/open save edits
)
const state = () => session.store.getState()

await session.restore(null)
assert(!state().restoring, "restore finishes")

// Persist creates the session on first use and activates it.
const first = await session.persist(node("hello"), "model-a", null)
assert(state().activeId === first, "persist activates the new session")
assert(activated[activated.length - 1] === first, "onActivate gets the new id")
assert(state().sessions.length === 1, "the new session is listed")

// Leaving a session flushes a pending edit.
session.edit({ system_prompt: "be terse" })
await session.startNew("model-a")
assert(state().activeId === null, "startNew clears the active session")
await session.open(first)
assert(state().data.system_prompt === "be terse", "the edit was saved")
assert(state().data.messages.length === 1, "messages survive reopening")

// A failed save keeps the edit dirty: leaving rejects and the edit stays.
const second = await session.persist(node("second"), "model-a", null)
await session.open(first)
session.edit({ system_prompt: "unsaved" })
failNextSave = true
let rejected = false
await session.open(second).catch(() => (rejected = true))
assert(rejected, "open rejects when the pending save fails")
assert(state().activeId === first, "the session is not left")
assert(state().data.system_prompt === "unsaved", "the edit is kept")
await session.open(second)
await session.open(first)
assert(state().data.system_prompt === "unsaved", "the retried save landed")

assert(errors.length === 0, `no errors reported: ${errors.join(", ")}`)
console.log("sessionStore tests passed")
