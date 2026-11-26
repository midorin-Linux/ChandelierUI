import assert from "node:assert/strict"
import { test } from "node:test"
import {
  branchesContaining,
  children,
  commit,
  createBranch,
  nextBranchName,
  pathToRoot,
  selectBranchFor,
  siblings,
} from "./sessionTree.ts"
import type { MessageNode, SessionData } from "../types/session.ts"

const node = (
  id: string,
  parent_id: string | null,
  role: "user" | "assistant" = "user"
): MessageNode => ({ id, parent_id, role, content: id, created_at: 1 })

const a = node("a", null)
const b = node("b", "a", "assistant")
const c = node("c", "b")
const ids = (nodes: MessageNode[]) => nodes.map((n) => n.id).join()

test("pathToRoot", () => {
  assert(
    ids(pathToRoot([c, a, b], "c")) === "a,b,c",
    "Path is root first, regardless of array order"
  )
  assert(pathToRoot([a, b], null).length === 0, "A null head has an empty path")
  assert(ids(pathToRoot([a, b, c], "a")) === "a", "The root is its own path")
  assert(
    ids(pathToRoot([a, b, c], "b")) === "a,b",
    "A non-leaf head ignores later nodes"
  )
  assert.throws(() => pathToRoot([b], "b"), "A missing parent throws")
  assert.throws(() => pathToRoot([a], "zzz"), "A missing head throws")
  assert.throws(
    () => pathToRoot([node("x", "y"), node("y", "x")], "x"),
    "A cycle throws"
  )
})

test("commit", () => {
  const data: SessionData = {
    model: "m",
    reasoning_effort: "off",
    system_prompt: "",
    messages: [a],
    branches: { main: "a", other: "a" },
    current_branch: "main",
    provider_id: null,
  }
  const snapshot = JSON.stringify(data)
  const next = commit(data, b)
  assert(JSON.stringify(data) === snapshot, "commit does not mutate its input")
  assert(
    next.messages.length === 2 && next.messages[1] === b,
    "commit appends the node"
  )
  assert(
    next.branches.main === "b" && next.branches.other === "a",
    "commit moves only the current branch head"
  )
})

const at = (
  id: string,
  parent_id: string | null,
  role: "user" | "assistant",
  created_at: number
): MessageNode => ({ id, parent_id, role, content: id, created_at })
const base = (
  messages: MessageNode[],
  branches: Record<string, string | null>,
  current_branch = "main"
): SessionData => ({
  model: "m",
  reasoning_effort: "off",
  system_prompt: "",
  messages,
  branches,
  current_branch,
  provider_id: null,
})

const r1 = at("r1", null, "user", 1)
const r2 = at("r2", null, "user", 2)
const x1 = at("x1", "r1", "assistant", 3)
const x2 = at("x2", "r1", "assistant", 4)

test("children and siblings", () => {
  // children / siblings
  const u2 = at("u2", "r1", "user", 5) // same parent, other role
  const tree = [r1, x1, r2, x2, u2]
  assert(ids(children(tree, null)) === "r1,r2", "Roots are children of null")
  assert(ids(children(tree, "r1")) === "x1,x2,u2", "children keep array order")
  assert(
    ids(siblings(tree, r2)) === "r1,r2",
    "Roots are siblings of each other"
  )
  assert(ids(siblings(tree, x2)) === "x1,x2", "siblings share the role")
  assert(ids(siblings(tree, u2)) === "u2", "A lone node is its own sibling")
})

test("nextBranchName", () => {
  // nextBranchName
  assert(
    nextBranchName({ main: null }) === "branch-2",
    "First name is branch-2"
  )
  assert(
    nextBranchName({ main: null, "branch-2": null, "branch-4": null }) ===
      "branch-3",
    "Gaps are filled"
  )
  assert(
    nextBranchName({ "branch-2": null, "branch-3": null }) === "branch-4",
    "Existing names are skipped"
  )
})

test("createBranch", () => {
  // createBranch
  const cd = base([a, b], { main: "b" })
  const cdSnap = JSON.stringify(cd)
  const cb = createBranch(cd, "a")
  assert(JSON.stringify(cd) === cdSnap, "createBranch does not mutate")
  assert(
    cb.current_branch === "branch-2" &&
      cb.branches["branch-2"] === "a" &&
      cb.branches.main === "b",
    "createBranch adds and selects the branch"
  )
  assert(
    createBranch(cd, null).branches["branch-2"] === null,
    "Null head works"
  )
})

test("branchesContaining and selectBranchFor", () => {
  // branchesContaining / selectBranchFor
  const sd = base([r1, x1, x2], { main: "x1", "branch-2": "x2", empty: null })
  assert(
    branchesContaining(sd, "r1").sort().join() === "branch-2,main",
    "Both heads contain the root; the empty branch contains nothing"
  )
  assert(branchesContaining(sd, "x2").join() === "branch-2", "Only one has x2")
  assert(
    selectBranchFor(sd, "x1") === sd,
    "Current branch containing it is a no-op"
  )
  assert(
    selectBranchFor(sd, "x2").current_branch === "branch-2",
    "Switches to the only containing branch"
  )
  const tie = base([r1, x1, x2], { main: "r1", z: "x1", y: "x2" })
  assert(
    selectBranchFor({ ...tie, current_branch: "main" }, "x2").current_branch ===
      "y",
    "Single match wins"
  )
  const newest = base([r1, x1, x2], { main: "r1", z: "x1", y: "x1", w: "x2" })
  const picked = selectBranchFor(newest, "r1")
  assert(picked === newest, "Current branch main contains r1")
  const pickedFromW = selectBranchFor({ ...newest, current_branch: "w" }, "x1")
  assert(pickedFromW.current_branch === "y", "Equal created_at: smallest name")
  const pickedNewest = selectBranchFor(
    { ...base([r1, x1, x2], { a: "x1", b: "x2" }), current_branch: "c" },
    "r1"
  )
  assert(pickedNewest.current_branch === "b", "Newest head wins")
})

test("selectBranchFor falls back to the newest leaf when no branch contains the node", () => {
  // fallback: no branch contains the node
  const orphan = base([r1, x1, x2, at("l", "x2", "user", 9)], { main: null })
  const fb = selectBranchFor(orphan, "r1")
  assert(
    fb.current_branch === "branch-2" && fb.branches["branch-2"] === "l",
    "Fallback branches off the newest leaf"
  )
  assert(orphan.current_branch === "main", "Fallback does not mutate")
})

test("every leaf stays a branch head through a simulated conversation", () => {
  // invariant: every leaf is some branch's head, plus Rust-side constraints
  function checkInvariant(d: SessionData, label: string): void {
    const index = new Map(d.messages.map((n, i) => [n.id, i]))
    for (const [i, n] of d.messages.entries()) {
      assert(
        n.parent_id === null || (index.get(n.parent_id) ?? Infinity) < i,
        `${label}: parent precedes ${n.id}`
      )
    }
    const heads = Object.values(d.branches)
    for (const h of heads) {
      assert(h === null || index.has(h), `${label}: head exists`)
    }
    assert(d.current_branch in d.branches, `${label}: current branch exists`)
    for (const n of d.messages) {
      if (children(d.messages, n.id).length === 0) {
        assert(heads.includes(n.id), `${label}: leaf ${n.id} is a head`)
      }
    }
  }
  let clock = 100
  let seq = 0
  const mk = (parent: string | null, role: "user" | "assistant") =>
    at(`n${seq++}`, parent, role, clock++)
  const headOf = (d: SessionData) => d.branches[d.current_branch]
  let s = base([], { main: null })
  function send(text: string): void {
    s = commit(s, mk(headOf(s), "user"))
    s = commit(s, mk(headOf(s), "assistant"))
    checkInvariant(s, `send ${text}`)
  }
  function regenerate(assistantId: string): void {
    const parent = s.messages.find((n) => n.id === assistantId)!.parent_id
    s = commit(createBranch(s, parent), mk(parent, "assistant"))
    checkInvariant(s, "regenerate")
  }
  function edit(userId: string): void {
    const parent = s.messages.find((n) => n.id === userId)!.parent_id
    s = createBranch(s, parent)
    s = commit(s, mk(parent, "user"))
    s = commit(s, mk(headOf(s), "assistant"))
    checkInvariant(s, "edit")
  }
  function pick(id: string): void {
    s = selectBranchFor(s, id)
    checkInvariant(s, "select")
    assert(
      pathToRoot(s.messages, headOf(s)).some((n) => n.id === id),
      "Selected node is displayed"
    )
  }
  send("1")
  send("2")
  regenerate(pathToRoot(s.messages, headOf(s)).slice(-1)[0].id)
  edit(pathToRoot(s.messages, headOf(s))[2].id) // mid-conversation user node
  edit(s.messages[0].id) // the first message: new root, null parent
  send("3")
  pick(s.messages[1].id)
  pick(s.messages[0].id)
  regenerate(s.messages[1].id)
  for (const n of [...s.messages]) pick(n.id)
  assert(s.messages.length > 8, "The simulation built a real tree")
  // A failed regenerate leaves an empty-ish branch at the user parent: still valid.
  s = createBranch(s, headOf(s) && s.messages[0].id)
  checkInvariant(s, "failed regenerate")
})
