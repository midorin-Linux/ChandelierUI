import { Channel, invoke, isTauri } from "@tauri-apps/api/core"
import type {
  AppError,
  AppPreferences,
  Bootstrap,
  GenerateInput,
  JsonValue,
  Message,
  Model,
  Provider,
  Session,
  SessionDetail,
  StreamEvent,
} from "../types/domain"

export function normalizeError(error: unknown): AppError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return { code: error.code, message: error.message }
  }
  return {
    code: "ipc",
    message: "アプリとの通信に失敗しました。もう一度お試しください。",
  }
}

function requireTauri() {
  if (!isTauri()) {
    throw {
      code: "tauri_required",
      message:
        "Tauriデスクトップアプリが必要です。ブラウザーのみでは利用できません。",
    } satisfies AppError
  }
}

async function command<T>(
  name: string,
  args?: Record<string, unknown>
): Promise<T> {
  requireTauri()
  try {
    return await invoke<T>(name, args)
  } catch (error) {
    throw normalizeError(error)
  }
}

export const sessionService = {
  bootstrap: () => command<Bootstrap>("bootstrap"),
  detail: (sessionId: string) =>
    command<SessionDetail>("session_detail", { sessionId }),
  generationMessage: (generationId: string) =>
    command<Message>("generation_message", { generationId }),
  create: (title: string) => command<Session>("create_session", { title }),
  update: (input: {
    sessionId: string
    title: string
    modelId: string | null
    settings: JsonValue
  }) => command<Session>("update_session", input),
  delete: (sessionId: string) => command<void>("delete_session", { sessionId }),
}

export const generationService = {
  generate: async (
    input: GenerateInput,
    onEvent: (event: StreamEvent) => void
  ) => {
    requireTauri()
    const channel = new Channel<StreamEvent>()
    channel.onmessage = onEvent
    return command<void>("generate", { input, onEvent: channel })
  },
  cancel: (sessionId: string) =>
    command<void>("cancel_generation", { sessionId }),
}

export const settingsService = {
  saveProvider: (provider: Provider, apiKey: string | null) =>
    command<Provider>("save_provider", { provider, apiKey }),
  deleteProvider: (providerId: string) =>
    command<void>("delete_provider", { providerId }),
  testProvider: (providerId: string) =>
    command<void>("test_provider", { providerId }),
  refreshModels: (providerId: string) =>
    command<Model[]>("refresh_models", { providerId }),
  saveModel: (model: Model) => command<Model>("save_model", { model }),
  deleteModel: (modelId: string) => command<void>("delete_model", { modelId }),
  saveSettings: (settings: AppPreferences) =>
    command<AppPreferences>("save_settings", { settings }),
}
