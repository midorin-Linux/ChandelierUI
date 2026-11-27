import type { SessionSummary } from "../types/session.ts"

export interface SessionGroup {
  label: string
  sessions: SessionSummary[]
}

const DAY = 24 * 60 * 60 * 1000

/**
 * Sessions matching `query` (case-insensitive, on the title), grouped by when
 * they were last updated. Keeps the given order inside each group; empty groups
 * are left out.
 */
export function groupSessions(
  sessions: readonly SessionSummary[],
  query: string,
  now = Date.now()
): SessionGroup[] {
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  const bounds: [string, number][] = [
    ["Today", midnight],
    ["Yesterday", midnight - DAY],
    ["Previous 7 days", midnight - 7 * DAY],
    ["Previous 30 days", midnight - 30 * DAY],
    ["Older", -Infinity],
  ]
  const needle = query.trim().toLowerCase()
  const groups = bounds.map(([label]) => ({
    label,
    sessions: [] as SessionSummary[],
  }))
  for (const session of sessions) {
    const title = session.title || "Untitled"
    if (needle && !title.toLowerCase().includes(needle)) continue
    const index = bounds.findIndex(([, from]) => session.updated_at >= from)
    groups[index].sessions.push(session)
  }
  return groups.filter((group) => group.sessions.length > 0)
}
