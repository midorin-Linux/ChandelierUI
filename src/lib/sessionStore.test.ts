import { createMemoryStorage } from "./memoryStorage.ts"
import { createSessionStore } from "./sessionStore.ts"
import type { CompletionAttempt } from "../types/analysis.ts"
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
const reply = (parent: string): MessageNode => ({
  id: crypto.randomUUID(),
  parent_id: parent,
  role: "assistant",
  content: "reply",
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
// While held, loads wait for `releaseLoads()`.
let held: Promise<void> | null = null
let releaseLoads = () => {}
const holdLoads = () => {
  held = new Promise((resolve) => (releaseLoads = resolve))
}
const loadSession = storage.loadSession
storage.loadSession = async (id) => {
  if (held) await held
  return loadSession(id)
}
const stored = async (id: string) => (await loadSession(id)).data.messages
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

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
const second = await session.persist(node("second"), "model-a", null)
assert(second !== first, "a new chat gets its own session")
await session.open(first)
assert(state().data.system_prompt === "be terse", "the edit was saved")
assert(state().data.messages.length === 1, "messages survive reopening")

// A failed save keeps the edit dirty: leaving rejects and the edit stays.
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

// ---- Switching while a reply streams --------------------------------------

const head = state().data.messages[0].id
const firstCount = (await stored(first)).length
const secondCount = (await stored(second)).length

// A save queued behind a switch saves the data it was asked to, not the session switched in.
holdLoads()
const opening = session.open(second)
await tick() // the load of `second` is queued and held
const committed = session.commit(first, reply(head))
held = null
releaseLoads()
await Promise.all([opening, committed])
assert(state().activeId === second, "the switch went through")
assert(
  (await stored(first)).length === firstCount + 1,
  "the reply is saved to its own session"
)
assert(
  (await stored(second)).length === secondCount,
  "the switched-in session is untouched"
)

// A reply for a session not on screen goes to its stored copy only.
const shown = state().data
await session.commit(first, reply(head))
assert((await stored(first)).length === firstCount + 2, "stored while hidden")
assert(state().data === shown, "the session on screen is untouched")

// Reopened while the reply was being saved: it appears once, on screen and stored.
holdLoads()
const reopening = session.open(first)
await tick()
const late = reply(head)
const lateCommit = session.commit(first, late)
held = null
releaseLoads()
await Promise.all([reopening, lateCommit])
const copies = (messages: readonly MessageNode[]) =>
  messages.filter((m) => m.id === late.id).length
assert(state().activeId === first, "reopened")
assert(copies(state().data.messages) === 1, "shown once after reopening")
assert(copies(await stored(first)) === 1, "stored once after reopening")

// Reopening mid-request must not hand out the in-flight attempt id again.
const inFlight = session.nextAttemptId()
await session.open(second)
await session.open(first)
await session.recordAttempt(first, { id: inFlight } as CompletionAttempt)
assert(session.nextAttemptId() > inFlight, "attempt ids are not reused")

assert(errors.length === 0, `no errors reported: ${errors.join(", ")}`)
console.log("sessionStore tests passed")
