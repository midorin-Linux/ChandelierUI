import type { CompletionAttempt } from "../types/analysis.ts"
import type { SessionData, SessionSummary, Storage } from "../types/session.ts"

const TITLE_CHARS = 40

/** Same contract as the SQLite commands, for the browser preview (data is lost on reload). */
export function createMemoryStorage(): Storage {
  const settings: Record<string, unknown> = {}
  const sessions = new Map<
    string,
    {
      summary: SessionSummary
      data: SessionData
      attempts: CompletionAttempt[]
    }
  >()
  let clock = 0
  const tick = () => (clock = Math.max(Date.now(), clock + 1))
  const find = (id: string) => {
    const session = sessions.get(id)
    if (!session) throw new Error(`not found: ${id}`)
    return session
  }
  return {
    getSettings: async () => ({ ...settings }),
    setSetting: async (key, value) => {
      if (!key) throw new Error("setting key is empty")
      settings[key] = value
    },
    listSessions: async () =>
      [...sessions.values()]
        .map((session) => session.summary)
        .sort((a, b) => b.updated_at - a.updated_at),
    createSession: async (data) => {
      const now = tick()
      const summary = {
        id: crypto.randomUUID(),
        title: [
          ...(data.messages.find((m) => m.role === "user")?.content.trim() ??
            ""),
        ]
          .slice(0, TITLE_CHARS)
          .join(""),
        created_at: now,
        updated_at: now,
      }
      sessions.set(summary.id, { summary, data, attempts: [] })
      return summary
    },
    loadSession: async (id) => structuredClone(find(id)),
    saveSession: async (id, data, title) => {
      const session = find(id)
      session.data = structuredClone(data)
      if (title !== undefined) session.summary.title = title
      return (session.summary.updated_at = tick())
    },
    renameSession: async (id, title) => {
      find(id).summary.title = title
    },
    deleteSession: async (id) => {
      sessions.delete(id)
    },
    appendAttempt: async (sessionId, attempt) => {
      const session = find(sessionId)
      if (session.attempts.some((a) => a.id === attempt.id)) {
        throw new Error(`duplicate attempt ${attempt.id}`)
      }
      session.attempts.push(structuredClone(attempt))
      session.attempts.sort((a, b) => a.id - b.id)
      session.summary.updated_at = tick()
    },
  }
}
