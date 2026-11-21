import type { CompletionAttempt } from "./analysis.ts"
import type { Effort } from "./chat.ts"

export interface MessageNode {
  id: string // crypto.randomUUID()
  parent_id: string | null // null only for the first message
  role: "user" | "assistant"
  content: string
  reasoning?: string
  created_at: number // Unix ms
}

/** Mirrors `SessionData` (schema_version 2) in src-tauri/src/storage/types.rs. */
export interface SessionData {
  model: string
  reasoning_effort: Effort
  system_prompt: string
  provider_id?: string | null // preset id; missing in sessions saved before presets
  messages: MessageNode[] // append-only, never mutated or removed
  branches: Record<string, string | null> // branch name -> head message id
  current_branch: string // "main" for new sessions
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
