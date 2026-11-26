import { Channel, isTauri } from "@tauri-apps/api/core"
import { commands, type Value } from "@/src/bindings"
import { createMemoryStorage } from "@/src/lib/memoryStorage"
import { createSettingsWriter } from "@/src/lib/settingsWriter"
import type { CompletionDelta, ProviderChatRequest } from "@/src/types/chat"
import type { CompletionAttempt } from "@/src/types/analysis"
import type { Storage } from "@/src/types/session"
import type { ErrorKind, IpcError } from "@/src/types/error"

/**
 * Every Tauri command the frontend calls goes through here (via the generated `commands`).
 * Outside the desktop app (browser preview) storage falls back to memory,
 * and commands that need the backend reject with a readable message.
 */
export const desktop = isTauri()

/** A failed command; `kind` says what went wrong, `message` is for display. */
export class ApiError extends Error {
  kind: ErrorKind

  constructor({ kind, message }: IpcError) {
    super(message)
    this.name = "ApiError"
    this.kind = kind
  }
}

const isIpcError = (cause: unknown): cause is IpcError =>
  typeof cause === "object" &&
  cause !== null &&
  typeof (cause as IpcError).kind === "string" &&
  typeof (cause as IpcError).message === "string"

/** Commands reject with `{ kind, message }`; Tauri itself may reject with a string. */
async function call<T>(command: Promise<T>): Promise<T> {
  try {
    return await command
  } catch (cause) {
    throw isIpcError(cause) ? new ApiError(cause) : cause
  }
}

const requireDesktop = (action: string) => {
  if (!desktop) {
    throw new Error(
      `${action} requires the Tauri desktop app. Open the desktop app instead of the browser preview.`
    )
  }
}

// Settings and attempts are JSON whose shape the frontend owns (the backend sees `Value`).
const tauriStorage: Storage = {
  getSettings: () => call(commands.getSettings()),
  setSetting: async (key, value) => {
    await call(commands.setSetting(key, value as Value))
  },
  listSessions: () => call(commands.listSessions()),
  createSession: (data) => call(commands.createSession(data)),
  loadSession: async (id) => {
    const session = await call(commands.loadSession(id))
    return {
      ...session,
      attempts: session.attempts as unknown as CompletionAttempt[],
    }
  },
  saveSession: (id, data, title) =>
    call(commands.saveSession(id, title ?? null, data)),
  renameSession: async (id, title) => {
    await call(commands.renameSession(id, title))
  },
  deleteSession: async (id) => {
    await call(commands.deleteSession(id))
  },
  appendAttempt: async (sessionId, attempt) => {
    await call(commands.appendAttempt(sessionId, attempt as unknown as Value))
  },
}

export const storage: Storage = desktop ? tauriStorage : createMemoryStorage()

/** The only writer of settings; see `createSettingsWriter`. */
export const settingsWriter = createSettingsWriter(storage)

/** Streams deltas to `onDelta`; resolves with the final message, or an error, and metrics. */
export async function chatCompletion(
  payload: ProviderChatRequest,
  onDelta: (delta: CompletionDelta) => void
) {
  requireDesktop("Sending messages")
  await settingsWriter.flush() // the backend resolves the preset from stored settings
  return call(
    commands.chatCompletion(payload, new Channel<CompletionDelta>(onDelta))
  )
}

/** No-op in the browser preview, where nothing can be in flight. */
export async function cancelChat() {
  if (desktop) await call(commands.cancelChat())
}

export async function listModels(provider: ProviderChatRequest["provider"]) {
  requireDesktop("Loading models")
  await settingsWriter.flush() // the backend resolves the preset from stored settings
  return call(commands.listModels(provider))
}

/** The browser preview has no keyring, so it never has a key. */
export async function hasApiKey(providerId: string) {
  return desktop ? call(commands.hasApiKey(providerId)) : false
}

export async function setApiKey(providerId: string, key: string) {
  requireDesktop("Saving keys")
  await call(commands.setApiKey(providerId, key))
}

/** No-op in the browser preview, which has no keyring to delete from. */
export async function deleteApiKey(providerId: string) {
  if (desktop) await call(commands.deleteApiKey(providerId))
}
