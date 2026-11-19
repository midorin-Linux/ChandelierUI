import type { CompletionAttempt } from "./analysis.ts"
import type { ChatMessage, Effort } from "./chat.ts"

/** Mirrors `SessionData` (schema_version 1) in src-tauri/src/storage/types.rs. */
export interface SessionData {
  model: string
  reasoning_effort: Effort
  system_prompt: string
  messages: ChatMessage[]
}

export interface SessionSummary {
  id: string
  title: string
  created_at: number
  updated_at: number
}

export interface LoadedSession {
  summary: SessionSummary
  data: SessionData
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
