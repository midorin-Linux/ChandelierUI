import { invoke, isTauri } from "@tauri-apps/api/core"
import { createMemoryStorage } from "@/src/lib/memoryStorage"
import type {
  LoadedSession,
  SessionSummary,
  Storage,
} from "@/src/types/session"

const tauriStorage: Storage = {
  getSettings: () => invoke("get_settings"),
  setSetting: (key, value) => invoke("set_setting", { key, value }),
  listSessions: () => invoke<SessionSummary[]>("list_sessions"),
  createSession: (data) => invoke<SessionSummary>("create_session", { data }),
  loadSession: (id) => invoke<LoadedSession>("load_session", { id }),
  saveSession: (id, data, title) =>
    invoke<number>("save_session", { id, data, title: title ?? null }),
  renameSession: (id, title) => invoke("rename_session", { id, title }),
  deleteSession: (id) => invoke("delete_session", { id }),
  appendAttempt: (sessionId, attempt) =>
    invoke("append_attempt", { sessionId, attempt }),
}

export const storage: Storage = isTauri() ? tauriStorage : createMemoryStorage()
