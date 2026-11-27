import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { createSettingsWriter } from "./settingsWriter.ts"

const stored: [string, unknown][] = []
const writer = createSettingsWriter(
  { setSetting: async (key, value) => void stored.push([key, value]) },
  10_000
)
beforeEach(() => {
  stored.length = 0
})

test("debounced values wait for flush; only the last one per key is written", async () => {
  writer.setDebounced("prompt", "a")
  writer.setDebounced("prompt", "ab")
  assert.deepEqual(stored, [])
  await writer.flush()
  assert.deepEqual(stored, [["prompt", "ab"]])
})

test("a direct write cancels a pending debounced value for the same key", async () => {
  writer.setDebounced("prompt", "stale")
  writer.set("prompt", "fresh")
  await writer.flush()
  assert.deepEqual(stored, [["prompt", "fresh"]])
})

test("writes land in call order", async () => {
  writer.set("a", 1)
  writer.set("b", 2)
  writer.set("a", 3)
  await writer.flush()
  assert.deepEqual(stored, [
    ["a", 1],
    ["b", 2],
    ["a", 3],
  ])
})

test("status counts unsaved values and reports failures until a later success", async () => {
  let fail = false
  const failing = createSettingsWriter(
    {
      setSetting: async () => {
        if (fail) throw new Error("disk full")
      },
    },
    10_000
  )
  const seen: number[] = []
  const unsubscribe = failing.subscribe(() =>
    seen.push(failing.status().pending)
  )
  failing.setDebounced("prompt", "a")
  assert.equal(failing.status().pending, 1, "A debounced value is unsaved")
  await failing.flush()
  assert.deepEqual(failing.status(), { pending: 0, error: null })
  assert(seen.length > 0, "Listeners hear about changes")

  fail = true
  const original = console.error
  console.error = () => {}
  failing.set("a", 1)
  await failing.flush()
  console.error = original
  assert.equal(failing.status().error, "disk full")

  fail = false
  failing.set("a", 2)
  await failing.flush()
  assert.equal(failing.status().error, null, "A later success clears it")
  unsubscribe()
})
