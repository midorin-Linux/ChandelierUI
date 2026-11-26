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
