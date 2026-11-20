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
