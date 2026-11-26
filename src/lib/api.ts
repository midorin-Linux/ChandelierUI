import { Channel, invoke, isTauri } from "@tauri-apps/api/core"
import { createMemoryStorage } from "@/src/lib/memoryStorage"
import type { MeasuredCompletion } from "@/src/types/analysis"
import type {
  ApiModel,
  CompletionDelta,
  ProviderChatRequest,
} from "@/src/types/chat"
import type {
  LoadedSession,
  SessionSummary,
  Storage,
} from "@/src/types/session"

/**
 * Every Tauri command the frontend calls lives here.
 * Outside the desktop app (browser preview) storage falls back to memory,
 * and commands that need the backend reject with a readable message.
 */
export const desktop = isTauri()

const requireDesktop = (action: string) => {
  if (!desktop) {
    throw new Error(
      `${action} requires the Tauri desktop app. Open the desktop app instead of the browser preview.`
    )
  }
}

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

export const storage: Storage = desktop ? tauriStorage : createMemoryStorage()

/** Streams deltas to `onDelta`; resolves with the final message, or an error, and metrics. */
export async function chatCompletion(
  payload: ProviderChatRequest,
  onDelta: (delta: CompletionDelta) => void
) {
  requireDesktop("Sending messages")
  return invoke<MeasuredCompletion>("chat_completion", {
    payload,
    onEvent: new Channel<CompletionDelta>(onDelta),
  })
}

/** No-op in the browser preview, where nothing can be in flight. */
export async function cancelChat() {
  if (desktop) await invoke("cancel_chat")
}

export async function listModels(provider: ProviderChatRequest["provider"]) {
  requireDesktop("Loading models")
  return invoke<ApiModel[]>("list_models", { provider })
}

/** The browser preview has no keyring, so it never has a key. */
export async function hasApiKey(providerId: string) {
  return desktop ? invoke<boolean>("has_api_key", { providerId }) : false
}

export async function setApiKey(providerId: string, key: string) {
  requireDesktop("Saving keys")
  await invoke("set_api_key", { providerId, key })
}

/** No-op in the browser preview, which has no keyring to delete from. */
export async function deleteApiKey(providerId: string) {
  if (desktop) await invoke("delete_api_key", { providerId })
}
