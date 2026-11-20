import { commit, pathToRoot } from "./sessionTree.ts"
import type { MessageNode, SessionData } from "../types/session.ts"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}
function throws(task: () => unknown): boolean {
  try {
    task()
    return false
  } catch {
    return true
  }
}

const node = (
  id: string,
  parent_id: string | null,
  role: "user" | "assistant" = "user"
): MessageNode => ({ id, parent_id, role, content: id, created_at: 1 })

const a = node("a", null)
const b = node("b", "a", "assistant")
const c = node("c", "b")
const ids = (nodes: MessageNode[]) => nodes.map((n) => n.id).join()

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
assert(
  throws(() => pathToRoot([b], "b")),
  "A missing parent throws"
)
assert(
  throws(() => pathToRoot([a], "zzz")),
  "A missing head throws"
)
assert(
  throws(() => pathToRoot([node("x", "y"), node("y", "x")], "x")),
  "A cycle throws"
)

const data: SessionData = {
  model: "m",
  reasoning_effort: "off",
  system_prompt: "",
  messages: [a],
  branches: { main: "a", other: "a" },
  current_branch: "main",
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
