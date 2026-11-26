import assert from "node:assert/strict"
import { test } from "node:test"
import {
  add,
  deletePreset,
  migrate,
  remove,
  sessionProvider,
  update,
} from "./providerPresets.ts"

const a = { id: "a", name: "A", baseUrl: "http://a/v1" }
const b = { id: "b", name: "B", baseUrl: "http://b/v1" }

test("migrate", () => {
  const legacy = migrate(undefined, "http://l/v1", () => "new")
  assert(
    legacy.length === 1 &&
      legacy[0].id === "new" &&
      legacy[0].name === "Default",
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
})

test("add and update", () => {
  assert(add([a], b).length === 2, "add appends")
  assert(
    update([a, b], "b", { name: "C" })[1].name === "C" &&
      update([a, b], "b", { name: "C" })[0].name === "A",
    "update changes only the matching preset"
  )
})

test("remove", () => {
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
})

test("deletePreset", async () => {
  const calls: string[] = []
  const deleted = await deletePreset([a, b], "a", "a", async (id) => {
    calls.push(id)
  })
  assert(
    calls.join() === "a" &&
      deleted.activeId === "b" &&
      deleted.presets.length === 1,
    "The key is deleted, then the preset is removed"
  )

  const failing = await deletePreset([a, b], "a", "a", async () => {
    throw new Error("keyring locked")
  }).then(
    () => null,
    (cause: Error) => cause.message
  )
  assert(
    failing === "keyring locked",
    "A failed key deletion rejects, so the caller keeps the preset"
  )
})

test("sessionProvider", () => {
  const own = sessionProvider([a, b], "b", "a")
  assert(
    own.id === "b" && !own.missing,
    "A session opens on its own provider when it still exists"
  )
  const deletedProvider = sessionProvider([a], "gone", "a")
  assert(
    deletedProvider.id === "a" && deletedProvider.missing,
    "A deleted provider falls back to the default and is flagged"
  )
  const legacySession = sessionProvider([a], null, "a")
  assert(
    legacySession.id === "a" && !legacySession.missing,
    "Sessions saved before presets use the default without a notice"
  )
  assert(
    sessionProvider([a], undefined, "stale").id === null,
    "A default that no longer exists selects nothing"
  )
})
