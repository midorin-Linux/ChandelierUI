import type { MessageNode, SessionData } from "../types/session.ts"

/** The root-first path ending at `headId`; `[]` for `null`. Throws on a missing parent or a cycle. */
export function pathToRoot(
  messages: readonly MessageNode[],
  headId: string | null
): MessageNode[] {
  const byId = new Map(messages.map((node) => [node.id, node]))
  const path: MessageNode[] = []
  const seen = new Set<string>()
  for (let id = headId; id !== null;) {
    const node = byId.get(id)
    if (!node) throw new Error(`message ${id} is missing`)
    if (seen.has(id)) throw new Error(`message ${id} is part of a cycle`)
    seen.add(id)
    path.push(node)
    id = node.parent_id
  }
  return path.reverse()
}

/** Appends `node` and moves the current branch head to it. Does not mutate `data`. */
export function commit(data: SessionData, node: MessageNode): SessionData {
  return {
    ...data,
    messages: [...data.messages, node],
    branches: { ...data.branches, [data.current_branch]: node.id },
  }
}

/** Nodes whose parent is `parentId` (`null` = roots), in array order. */
export function children(
  messages: readonly MessageNode[],
  parentId: string | null
): MessageNode[] {
  return messages.filter((node) => node.parent_id === parentId)
}

/** Nodes with the same parent and role as `node`, in array order, including `node`. */
export function siblings(
  messages: readonly MessageNode[],
  node: MessageNode
): MessageNode[] {
  return children(messages, node.parent_id).filter(
    (other) => other.role === node.role
  )
}

/** The smallest unused `branch-N` with N >= 2; `main` is never renamed. */
export function nextBranchName(branches: Record<string, unknown>): string {
  let n = 2
  while (`branch-${n}` in branches) n++
  return `branch-${n}`
}

/** Adds a branch pointing at `head` and makes it current. Does not mutate `data`. */
export function createBranch(
  data: SessionData,
  head: string | null
): SessionData {
  const name = nextBranchName(data.branches)
  return {
    ...data,
    branches: { ...data.branches, [name]: head },
    current_branch: name,
  }
}

/** Names of the branches whose head path includes `nodeId`. */
export function branchesContaining(
  data: SessionData,
  nodeId: string
): string[] {
  return Object.keys(data.branches).filter((name) =>
    pathToRoot(data.messages, data.branches[name]).some(
      (node) => node.id === nodeId
    )
  )
}

/**
 * Makes the displayed branch contain `nodeId`. Keeps the current branch if it
 * already does; otherwise picks the containing branch whose head is newest
 * (ties: smallest name). If none contains it, branches off the newest leaf below it.
 */
export function selectBranchFor(
  data: SessionData,
  nodeId: string
): SessionData {
  const names = branchesContaining(data, nodeId)
  if (names.includes(data.current_branch)) return data
  const created = (name: string) => {
    const head = data.branches[name]
    return data.messages.find((node) => node.id === head)?.created_at ?? 0
  }
  const best = names.sort(
    (x, y) => created(y) - created(x) || x.localeCompare(y)
  )[0]
  if (best !== undefined) return { ...data, current_branch: best }
  // Invariant broken (no branch reaches this node): descend via the newest child.
  let leaf = nodeId
  for (;;) {
    const kids = children(data.messages, leaf)
    if (kids.length === 0) break
    leaf = kids.reduce((newest, kid) =>
      kid.created_at >= newest.created_at ? kid : newest
    ).id
  }
  return createBranch(data, leaf)
}
