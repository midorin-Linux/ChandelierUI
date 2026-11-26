import { createSettingsWriter } from "./settingsWriter.ts"

function same(actual: unknown, expected: unknown): void {
  const [a, b] = [JSON.stringify(actual), JSON.stringify(expected)]
  if (a !== b) throw new Error(`expected ${b}, got ${a}`)
}

const stored: [string, unknown][] = []
const writer = createSettingsWriter(
  { setSetting: async (key, value) => void stored.push([key, value]) },
  10_000
)

// Debounced values wait for flush; only the last one per key is written.
writer.setDebounced("prompt", "a")
writer.setDebounced("prompt", "ab")
same(stored, [])
await writer.flush()
same(stored, [["prompt", "ab"]])

// A direct write cancels a pending debounced value for the same key.
stored.length = 0
writer.setDebounced("prompt", "stale")
writer.set("prompt", "fresh")
await writer.flush()
same(stored, [["prompt", "fresh"]])

// Writes land in call order.
stored.length = 0
writer.set("a", 1)
writer.set("b", 2)
writer.set("a", 3)
await writer.flush()
same(stored, [
  ["a", 1],
  ["b", 2],
  ["a", 3],
])

console.log("settingsWriter tests passed")
