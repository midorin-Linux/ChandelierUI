import type { CompletionAttempt } from "./analysis.ts"
import type {
  LoadedSession_Serialize,
  SessionData_Serialize as SessionData,
  SessionSummary,
} from "../bindings"

export type {
  MessageNode_Serialize as MessageNode,
  SessionData_Serialize as SessionData,
  SessionSummary,
} from "../bindings"

/** Attempts cross IPC as plain JSON; the frontend owns their shape. */
export type LoadedSession = Omit<LoadedSession_Serialize, "attempts"> & {
  attempts: CompletionAttempt[]
}

export interface Storage {
  getSettings: () => Promise<Record<string, unknown>>
  setSetting: (key: string, value: unknown) => Promise<void>
  listSessions: () => Promise<SessionSummary[]>
  createSession: (data: SessionData) => Promise<SessionSummary>
  loadSession: (id: string) => Promise<LoadedSession>
  saveSession: (
    id: string,
    data: SessionData,
    title?: string
  ) => Promise<number>
  renameSession: (id: string, title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  appendAttempt: (
    sessionId: string,
    attempt: CompletionAttempt
  ) => Promise<void>
}
