import assert from "node:assert/strict"
import { test } from "node:test"
import { groupSessions } from "./sessionGroups.ts"

const now = new Date(2026, 10, 27, 15, 0).getTime()
const at = (days: number, hour = 12) =>
  new Date(2026, 10, 27 - days, hour).getTime()
const summary = (id: string, title: string, updated_at: number) => ({
  id,
  title,
  created_at: updated_at,
  updated_at,
})

const sessions = [
  summary("a", "Rust lifetimes", at(0, 1)),
  summary("b", "", at(1, 23)),
  summary("c", "Tauri windows", at(3)),
  summary("d", "rust macros", at(20)),
  summary("e", "Old notes", at(90)),
]

test("groups by local day of the last update", () => {
  assert.deepEqual(
    groupSessions(sessions, "", now).map((g) => [
      g.label,
      g.sessions.map((s) => s.id),
    ]),
    [
      ["Today", ["a"]],
      ["Yesterday", ["b"]],
      ["Previous 7 days", ["c"]],
      ["Previous 30 days", ["d"]],
      ["Older", ["e"]],
    ]
  )
})

test("filters titles case-insensitively and drops empty groups", () => {
  assert.deepEqual(
    groupSessions(sessions, "  RUST ", now).map((g) => g.label),
    ["Today", "Previous 30 days"]
  )
  // An empty title is searched as it is shown.
  assert.equal(groupSessions(sessions, "untitled", now)[0].sessions[0].id, "b")
  assert.deepEqual(groupSessions(sessions, "nothing", now), [])
})
