import { add, migrate, remove, update } from "./providerPresets.ts"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const a = { id: "a", name: "A", baseUrl: "http://a/v1" }
const b = { id: "b", name: "B", baseUrl: "http://b/v1" }

const legacy = migrate(undefined, "http://l/v1", () => "new")
assert(
  legacy.length === 1 && legacy[0].id === "new" && legacy[0].name === "Default",
  "A legacy base URL becomes one Default preset"
)
assert(migrate(undefined, "", () => "x").length === 0, "No URL, no preset")
assert(
  migrate([a, { id: 1 }, null], "http://l/v1").length === 1,
  "Saved presets win over the legacy URL and invalid entries are dropped"
)
assert(
  migrate([], "http://l/v1").length === 0,
  "A saved empty list stays empty"
)

assert(add([a], b).length === 2, "add appends")
assert(
  update([a, b], "b", { name: "C" })[1].name === "C" &&
    update([a, b], "b", { name: "C" })[0].name === "A",
  "update changes only the matching preset"
)

const keep = remove([a, b], "a", "b")
assert(
  keep.activeId === "a" && keep.presets.length === 1,
  "Other removal keeps active"
)
const next = remove([a, b], "a", "a")
assert(
  next.activeId === "b",
  "Removing the active preset picks the first remaining"
)
const none = remove([a], "a", "a")
assert(
  none.activeId === null && none.presets.length === 0,
  "Removing the last leaves none"
)
